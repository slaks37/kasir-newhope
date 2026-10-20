import type express from 'express';
import { randomUUID } from 'node:crypto';
import type { Db } from '../shared/db';
import { AuthUnavailableError, authenticateBearer, tenantForPrincipal, trustedPrincipal } from '../shared/auth';
import {reconcileInvoiceByInquiry} from './recovery';
import {BusinessScopeError,resolveBusinessScope} from '../pos/businessScope';
import { SAAS_PLANS } from '../../src/config/saasPlans';
import { isFreePlan } from '../../src/config/freePlanPolicy';
import { validateFreeBranchSelection, FreePlanAccessError } from './freePlan';
import { BillingError, assertOutletCapacity, assertTenantWritable, createQuote, reconcilePayment, serializeInvoice, subscriptionStatus, activateFreeTrial } from './engine';
import { createDokuCheckout, isDokuConfigured, verifyDokuWebhookSignature, getDokuAllowedChannels, generateDigest, DOKU_NOTIFICATION_PATH, checkDokuOrderStatus } from '../../api/_doku';

/** A missing or out-of-range coordinate is stored as NULL ("not set"), never 0 — 0,0 is a real place in the Atlantic. */
function coordinate(value: unknown, limit: number): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && Math.abs(n) <= limit && n !== 0 ? n : null;
}

export function registerBillingRoutes(app:express.Express,db:Db,viaGateway=false,checkoutProvider=createDokuCheckout,inquiryProvider=checkDokuOrderStatus) {
  const run=(fn:(req:express.Request,res:express.Response)=>Promise<unknown>)=>async(req:express.Request,res:express.Response)=>{
    try { await fn(req,res); } catch(err) {
      if(req.path===DOKU_NOTIFICATION_PATH && err instanceof BillingError)console.warn('[doku] NOTIFICATION_REJECTED',err.message);
      if (err instanceof AuthUnavailableError) return res.status(503).json({ok:false,error:'AUTH_UNAVAILABLE'});
      if (!(err instanceof BillingError)){
        const diagnostic=err as {code?:string;constraint?:string;table?:string;column?:string};
        console.error('[billing] INTERNAL_OPERATION_FAILED',{route:req.path,code:diagnostic.code,constraint:diagnostic.constraint,table:diagnostic.table,column:diagnostic.column});
      }
      res.status(err instanceof BillingError?err.status:500).json({ok:false,error:err instanceof BillingError?err.message:'BILLING_UNAVAILABLE'});
    }
  };
  const tenant=async(req:express.Request)=>{
    const principal=viaGateway?trustedPrincipal(req):await authenticateBearer(req);
    const allowLocal = process.env.NODE_ENV !== 'production' && process.env.AUTH_ALLOW_LOCAL_DEVELOPMENT === '1';
    if (!principal || (principal.subject==='local-development' && !allowLocal)) throw new BillingError(401,'AUTHENTICATION_REQUIRED');
    let id=await tenantForPrincipal(db,principal);
    if (!id && principal.subject!=='local-development') {
      const name = principal.email ? principal.email.split('@')[0] : 'Toko Utama';
      const res = await db.query(
        `INSERT INTO internal.tenants (id, name, external_ref, owner_user_ref, is_active)
         VALUES (uuidv7(), $1, $2, $2, true)
         ON CONFLICT (external_ref) WHERE external_ref IS NOT NULL
           DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [name, principal.subject]
      );
      id = res.rows[0]?.id;
    }
    if (!id) throw new BillingError(403,'TENANT_NOT_PROVISIONED');
    return id;
  };
  app.get('/api/v1/subscription/plans',(_req,res)=>res.json({ok:true,plans:SAAS_PLANS}));
  app.get('/api/v1/subscription/status',run(async(req,res)=>res.json(await subscriptionStatus(db,await tenant(req)))));
  app.post('/api/v1/subscription/start-trial',run(async(req,res)=>res.json({ok:true,subscription:await activateFreeTrial(db,await tenant(req))})));
  app.post('/api/v1/subscription/free-plan',run(async(req,res)=>{
    const principal=viaGateway?trustedPrincipal(req):await authenticateBearer(req);
    if(!principal || principal.subject==='local-development') throw new BillingError(401,'AUTHENTICATION_REQUIRED');
    res.setHeader('Cache-Control','no-store');
    const tenantId=await db.tx(async c=>{
      const {rows}=await c.query(`SELECT s.* FROM billing.subscriptions s JOIN internal.tenants t ON t.id=s.tenant_id
        WHERE t.owner_user_ref=$1 AND t.is_active ORDER BY t.created_at,t.id LIMIT 1 FOR UPDATE OF s`,[principal.subject]);
      const s=rows[0];
      if(!s || !isFreePlan({status:s.status,planId:s.plan_id,currentPeriodEnd:new Date(s.current_period_end).toISOString()})) throw new BillingError(409,'FREE_PLAN_NOT_ELIGIBLE');
      try {
        const selection=await validateFreeBranchSelection(c,principal.subject,req.body);
        await c.query('UPDATE billing.subscriptions SET free_selection=$2::jsonb,updated_at=now() WHERE id=$1',[s.id,JSON.stringify(selection)]);
      } catch(error) {
        if(error instanceof FreePlanAccessError) throw new BillingError(409,error.message);
        if(error instanceof Error && error.message==='INVALID_FREE_SELECTION') throw new BillingError(400,error.message);
        throw error;
      }
      return s.tenant_id;
    });
    res.json(await subscriptionStatus(db,tenantId));
  }));
  app.get('/api/v1/subscription/outlets',run(async(req,res)=>{
    const {rows}=await db.query(`SELECT o.*,m.business_sector FROM internal.outlets o JOIN internal.merchants m ON m.id=o.merchant_id WHERE o.tenant_id=$1 ORDER BY o.created_at`,[await tenant(req)]);
    res.json({ok:true,rows});
  }));
  app.post('/api/v1/subscription/outlets',run(async(req,res)=>{
    const tenantId=await tenant(req),b=req.body || {};
    const principal=viaGateway?trustedPrincipal(req):await authenticateBearer(req);
    if(!principal || principal.subject==='local-development') throw new BillingError(401,'AUTHENTICATION_REQUIRED');
    const sector=String(b.businessSector || 'FNB');
    if(!['FNB','RETAIL','LAUNDRY','BARBERSHOP','CARWASH'].includes(sector)) throw new BillingError(400,'INVALID_BUSINESS_SECTOR');
    if(!b.name || !String(b.name).trim() || String(b.name).length>150) throw new BillingError(400,'INVALID_OUTLET_NAME');
    const result=await db.tx(async c=>{
      await c.query('SELECT id FROM internal.tenants WHERE id=$1 FOR UPDATE',[tenantId]);
      await assertTenantWritable(c,tenantId);
      let scope;
      try{scope=await resolveBusinessScope(c,principal.subject,sector,b.businessId);}
      catch(error){if(error instanceof BusinessScopeError)throw new BillingError(error.status,error.message);throw error;}
      if(!scope||scope.tenantId!==tenantId) throw new BillingError(409,'BUSINESS_SETUP_REQUIRED');
      const merchant={id:scope.merchantId};
      const id=/^[0-9a-f-]{36}$/i.test(b.id || '')?b.id:randomUUID();
      const existing=(await c.query('SELECT * FROM internal.outlets WHERE id=$1',[id])).rows[0];
      if(existing && (existing.tenant_id!==tenantId || existing.merchant_id!==merchant.id)) throw new BillingError(403,'OUTLET_NOT_OWNED');
      if(b.isActive!==false) await assertOutletCapacity(c,tenantId,id);
      const {rows}=await c.query(`INSERT INTO internal.outlets(id,tenant_id,merchant_id,name,address,latitude,longitude,radius_meters,is_active)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(id) DO UPDATE SET name=excluded.name,address=excluded.address,
        latitude=excluded.latitude,longitude=excluded.longitude,radius_meters=excluded.radius_meters,is_active=excluded.is_active RETURNING *`,
        [id,tenantId,merchant.id,String(b.name).trim(),String(b.address ?? existing?.address ?? ''),coordinate(b.latitude ?? existing?.latitude,90),coordinate(b.longitude ?? existing?.longitude,180),Math.max(1,Number(b.allowedRadiusMeters ?? existing?.radius_meters)||100),b.isActive!==false]);
      return rows[0];
    });res.json({ok:true,outlet:result});
  }));
  app.post('/api/v1/subscription/prorated-upgrade',run(async(req,res)=>{
    const quote=await createQuote(db,await tenant(req),req.body || {});
    res.json({ok:true,...quote,netProratedAmount:quote.amount,proratedAmountIdr:quote.amount,breakdown:{newPlanPrice:quote.recurringAmount,unusedCredit:quote.unusedCredit,total:quote.amount}});
  }));
  app.post('/api/v1/subscription/checkout',run(async(req,res)=>{
    if(process.env.DOKU_PAYMENTS_ENABLED?.trim()!=='1') throw new BillingError(503,'PAYMENTS_PAUSED');
    const tenantId=await tenant(req);
    const key=String(req.body?.requestKey || '');
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)) throw new BillingError(400,'CHECKOUT_REQUEST_KEY_REQUIRED');
    let configured=false;try{configured=isDokuConfigured();}catch{/* configuration error, no provider call */}
    if (!configured) throw new BillingError(503,'PAYMENT_GATEWAY_NOT_CONFIGURED');
    let allowedChannels:string[];
    try{allowedChannels=getDokuAllowedChannels();}catch{throw new BillingError(503,'DOKU_CHANNEL_SCOPE_NOT_CONFIGURED');}
    const quote={...await createQuote(db,tenantId,req.body || {}),allowedChannels};
    if (quote.amount<=0) throw new BillingError(409,'ZERO_CHARGE_REQUIRES_SUPPORT');
    const origin=process.env.PUBLIC_APP_URL;
    if (!origin || !/^https:\/\/[^/?#@]+\/?$/.test(origin)) throw new BillingError(503,'PUBLIC_APP_URL_NOT_CONFIGURED');
    const id=randomUUID(),invoiceNumber=`NH-${id}`;
    // Persist intent BEFORE external checkout. A fast webhook cannot outrun it.
    const result=await db.tx(async c=>{
      await c.query('SELECT id FROM internal.tenants WHERE id=$1 FOR UPDATE',[tenantId]);
      const current=(await c.query('SELECT revision FROM billing.subscriptions WHERE tenant_id=$1 FOR UPDATE',[tenantId])).rows[0];
      if(Number(current?.revision)!==quote.revision)throw new BillingError(409,'CHECKOUT_QUOTE_CHANGED');
      const sameKey=(await c.query('SELECT * FROM billing.invoices WHERE tenant_id=$1 AND checkout_key=$2',[tenantId,key])).rows[0];
      if(sameKey)return {rowCount:0,rows:[sameKey]};
      // Different tabs/devices must not create two payable orders for one
      // subscription revision. Old timed-out intents require inquiry/review.
      const open=(await c.query(`SELECT * FROM billing.invoices WHERE tenant_id=$1 AND payment_status='PENDING'
        AND due_date>now() AND quote->>'revision'=$2::text ORDER BY created_at LIMIT 1`,[tenantId,quote.revision])).rows[0];
      if(open){
        if(open.quote?.planId!==quote.planId || open.quote?.billingCycle!==quote.billingCycle || open.quote?.extraOutlets!==quote.extraOutlets)throw new BillingError(409,'CHECKOUT_PENDING_EXISTS');
        return {rowCount:0,rows:[open]};
      }
      return c.query(`INSERT INTO billing.invoices(id,subscription_id,tenant_id,amount,currency,due_date,invoice_number,quote,checkout_key)
        SELECT $1,id,tenant_id,$3,'IDR',now()+interval '24 hours',$4,$5::jsonb,$6 FROM billing.subscriptions
        WHERE tenant_id=$2 RETURNING *`,[id,tenantId,quote.amount,invoiceNumber,JSON.stringify(quote),key]);
    });
    if(!result.rowCount){
      const existing=result.rows[0];
      if(existing?.quote?.planId!==quote.planId || existing?.quote?.billingCycle!==quote.billingCycle || existing?.quote?.extraOutlets!==quote.extraOutlets) throw new BillingError(409,'CHECKOUT_KEY_CONFLICT');
      if(existing.payment_status==='PAID') return res.json({ok:true,paid:true,invoice:serializeInvoice(existing),replayed:true});
      if(new Date(existing.due_date).getTime()<=Date.now()) throw new BillingError(409,'CHECKOUT_EXPIRED');
      if(!existing.payment_link_url) throw new BillingError(409,'CHECKOUT_IN_PROGRESS_OR_NEEDS_REVIEW');
      return res.json({ok:true,paymentUrl:existing.payment_link_url,invoice:serializeInvoice(existing),quote:existing.quote,replayed:true});
    }
    try {
      const checkout=await checkoutProvider({order:{invoice_number:invoiceNumber,amount:quote.amount,currency:'IDR',
        callback_url:`${origin.replace(/\/$/,'')}/subscription?invoice=${id}`,auto_redirect:true,
        line_items:[{name:`${quote.planName} ${quote.billingCycle} + ${quote.extraOutlets} outlet`,price:quote.amount,quantity:1}]},payment:{payment_due_date:1440,payment_method_types:allowedChannels}});
      await db.query('UPDATE billing.invoices SET payment_link_url=$2 WHERE id=$1',[id,checkout.paymentUrl]);
      res.json({ok:true,paymentUrl:checkout.paymentUrl,invoice:serializeInvoice({...result.rows[0],payment_link_url:checkout.paymentUrl}),quote});
    } catch(err) {
      await db.query("UPDATE billing.invoices SET reconciliation_status='REVIEW',reconciliation_note='CHECKOUT_RESPONSE_FAILED' WHERE id=$1 AND payment_status<>'PAID'",[id]);
      throw err;
    }
  }));
  app.get('/api/v1/subscription/verify',run(async(req,res)=>{
    const tenantId=await tenant(req);
    const invoiceId=typeof req.query?.invoiceId==='string'?req.query.invoiceId:undefined;
    const invoiceNumber=typeof req.query?.invoiceNumber==='string'?req.query.invoiceNumber:undefined;
    let query='SELECT * FROM billing.invoices WHERE tenant_id=$1';
    const params:any[]=[tenantId];
    if(invoiceId){query+=' AND id=$2';params.push(invoiceId);}
    else if(invoiceNumber){query+=' AND invoice_number=$2';params.push(invoiceNumber);}
    else {query+=' ORDER BY created_at DESC LIMIT 1';}
    const {rows}=await db.query(query,params);
    const inv=rows[0];
    if(!inv) throw new BillingError(404,'INVOICE_NOT_FOUND');
    if(inv.payment_status!=='PAID' || inv.reconciliation_status!=='APPLIED') {
      let configured=false;try{configured=isDokuConfigured();}catch{/* fail closed */}
      if(configured) {
        try {
          await reconcileInvoiceByInquiry(db,inv,inquiryProvider);
        } catch {
          // Never log raw provider/driver errors (may contain payment tokens).
          console.warn('[doku-verify] INQUIRY_UNAVAILABLE');
        }
      }
    }
    const fresh=(await db.query('SELECT * FROM billing.invoices WHERE id=$1 AND tenant_id=$2',[inv.id,tenantId])).rows[0];
    const statusData=await subscriptionStatus(db,tenantId);
    const paid=fresh.payment_status==='PAID' && fresh.reconciliation_status==='APPLIED';
    res.json({ok:true,paid,status:paid?statusData.subscription.status:'PENDING_PAYMENT',
      invoice:serializeInvoice(fresh),subscription:statusData.subscription});
  }));
  // Never expose an endpoint that turns a client request into money received.
  app.post('/api/v1/subscription/simulate-payment',(_req,res)=>res.status(403).json({ok:false,error:'PAYMENT_SIMULATION_DISABLED'}));
  app.post('/api/v1/webhooks/payment-gateway',(_req,res)=>res.status(410).json({ok:false,error:'USE_SIGNED_DOKU_WEBHOOK'}));
  app.post(DOKU_NOTIFICATION_PATH,run(async(req,res)=>{
    const raw=(req as any).rawBody;
    if (!raw || !verifyDokuWebhookSignature(req.headers,raw,DOKU_NOTIFICATION_PATH)) throw new BillingError(401,'INVALID_WEBHOOK_SIGNATURE');
    let channels:string[];
    try{channels=getDokuAllowedChannels();}catch{throw new BillingError(503,'DOKU_CHANNEL_SCOPE_NOT_CONFIGURED');}
    // Interpret exactly the authenticated bytes, never a transformed req.body.
    let body:any;try{body=JSON.parse(raw.toString('utf8'));}catch{throw new BillingError(400,'INVALID_NOTIFICATION_JSON');}
    if(!body || typeof body!=='object' || Array.isArray(body))throw new BillingError(400,'INVALID_NOTIFICATION_BODY');
    const status=String(body?.transaction?.status || '');
    const channel=typeof body?.channel?.id==='string'?body.channel.id:'';
    const invoice=body?.order?.invoice_number,amount=body?.order?.amount;
    if(typeof invoice!=='string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(invoice) ||
      !['string','number'].includes(typeof amount) || !/^\d+(?:\.\d{1,2})?$/.test(String(amount)) || !Number.isFinite(Number(amount)))throw new BillingError(400,'INVALID_NOTIFICATION_ORDER');
    const issue=!channel || !channels.includes(channel)?'UNAPPROVED_PAYMENT_CHANNEL':['REFUNDED','PARTIAL_REFUNDED'].includes(status)?'REFUND_REQUIRES_REVIEW':['VOIDED','REVERSED'].includes(status)?'REVERSAL_REQUIRES_REVIEW':!['SUCCESS','FAILED','PENDING','EXPIRED','CANCELLED','ORDER_EXPIRED'].includes(status)?'UNKNOWN_PAYMENT_STATUS':undefined;
    const result=await reconcilePayment(db,{eventKey:String(req.headers['request-id'] || ''),
      invoiceNumber:invoice,reference:String(body?.transaction?.original_request_id || req.headers['request-id'] || '').slice(0,128),
      amount:Number(amount),currency:body?.order?.currency===undefined?'IDR':String(body.order.currency),success:status==='SUCCESS',
      channel,validationIssue:issue,contentDigest:generateDigest(raw),payload:{status,channel,requestTimestamp:req.headers['request-timestamp']}});
    res.json(result);
  }));
  app.all(DOKU_NOTIFICATION_PATH,(_req,res)=>res.set('Allow','POST').status(405).json({ok:false,error:'METHOD_NOT_ALLOWED'}));
}
