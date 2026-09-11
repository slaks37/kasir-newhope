import type express from 'express';
import { randomUUID } from 'node:crypto';
import type { Db } from '../shared/db';
import { authenticateBearer, tenantForPrincipal, trustedPrincipal } from '../shared/auth';
import { SAAS_PLANS } from '../../src/config/saasPlans';
import { BillingError, assertOutletCapacity, assertTenantWritable, createQuote, reconcilePayment, serializeInvoice, subscriptionStatus } from './engine';
import { createDokuCheckout, isDokuConfigured, verifyDokuWebhookSignature, getDokuAllowedChannels, generateDigest, DOKU_NOTIFICATION_PATH } from '../../api/_doku';

export function registerBillingRoutes(app:express.Express,db:Db,viaGateway=false,checkoutProvider=createDokuCheckout) {
  const run=(fn:(req:express.Request,res:express.Response)=>Promise<unknown>)=>async(req:express.Request,res:express.Response)=>{
    try { await fn(req,res); } catch(err) {
      if(req.path===DOKU_NOTIFICATION_PATH && err instanceof BillingError)console.warn('[doku] NOTIFICATION_REJECTED',err.message);
      if (!(err instanceof BillingError)) console.error('[billing] INTERNAL_OPERATION_FAILED');
      res.status(err instanceof BillingError?err.status:500).json({ok:false,error:err instanceof BillingError?err.message:'BILLING_UNAVAILABLE'});
    }
  };
  const tenant=async(req:express.Request)=>{
    const principal=viaGateway?trustedPrincipal(req):await authenticateBearer(req);
    if (!principal || principal.subject==='local-development') throw new BillingError(401,'AUTHENTICATION_REQUIRED');
    const id=await tenantForPrincipal(db,principal);
    if (!id) throw new BillingError(403,'TENANT_NOT_PROVISIONED');
    return id;
  };
  app.get('/api/v1/subscription/plans',(_req,res)=>res.json({ok:true,plans:SAAS_PLANS}));
  app.get('/api/v1/subscription/status',run(async(req,res)=>res.json(await subscriptionStatus(db,await tenant(req)))));
  app.get('/api/v1/subscription/outlets',run(async(req,res)=>{
    const {rows}=await db.query(`SELECT o.*,m.business_sector FROM internal.outlets o JOIN internal.merchants m ON m.id=o.merchant_id WHERE o.tenant_id=$1 ORDER BY o.created_at`,[await tenant(req)]);
    res.json({ok:true,rows});
  }));
  app.post('/api/v1/subscription/outlets',run(async(req,res)=>{
    const tenantId=await tenant(req),b=req.body || {};
    if(!b.name || String(b.name).length>150) throw new BillingError(400,'INVALID_OUTLET_NAME');
    const result=await db.tx(async c=>{
      await c.query('SELECT id FROM internal.tenants WHERE id=$1 FOR UPDATE',[tenantId]);
      await assertTenantWritable(c,tenantId);
      const merchant=(await c.query('SELECT id FROM internal.merchants WHERE tenant_id=$1 AND business_sector=$2 ORDER BY created_at LIMIT 1',[tenantId,b.businessSector || 'FNB'])).rows[0];
      if(!merchant) throw new BillingError(409,'SYNC_BUSINESS_BEFORE_ADDING_OUTLET');
      const id=/^[0-9a-f-]{36}$/i.test(b.id || '')?b.id:randomUUID();
      const existing=(await c.query('SELECT tenant_id FROM internal.outlets WHERE id=$1',[id])).rows[0];
      if(existing && existing.tenant_id!==tenantId) throw new BillingError(403,'OUTLET_NOT_OWNED');
      if(b.isActive!==false) await assertOutletCapacity(c,tenantId,id);
      const {rows}=await c.query(`INSERT INTO internal.outlets(id,tenant_id,merchant_id,name,address,latitude,longitude,radius_meters,is_active)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(id) DO UPDATE SET name=excluded.name,address=excluded.address,
        latitude=excluded.latitude,longitude=excluded.longitude,radius_meters=excluded.radius_meters,is_active=excluded.is_active RETURNING *`,
        [id,tenantId,merchant.id,String(b.name),String(b.address || ''),Number(b.latitude)||0,Number(b.longitude)||0,Math.max(1,Number(b.allowedRadiusMeters)||100),b.isActive!==false]);
      return rows[0];
    });res.json({ok:true,outlet:result});
  }));
  app.post('/api/v1/subscription/prorated-upgrade',run(async(req,res)=>{
    const quote=await createQuote(db,await tenant(req),req.body || {});
    res.json({ok:true,...quote,netProratedAmount:quote.amount,proratedAmountIdr:quote.amount,breakdown:{newPlanPrice:quote.recurringAmount,unusedCredit:quote.unusedCredit,total:quote.amount}});
  }));
  app.post('/api/v1/subscription/checkout',run(async(req,res)=>{
    const tenantId=await tenant(req);
    const key=String(req.body?.requestKey || '');
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)) throw new BillingError(400,'CHECKOUT_REQUEST_KEY_REQUIRED');
    if (!isDokuConfigured()) throw new BillingError(503,'PAYMENT_GATEWAY_NOT_CONFIGURED');
    let allowedChannels:string[];
    try{allowedChannels=getDokuAllowedChannels();}catch{throw new BillingError(503,'DOKU_CHANNEL_SCOPE_NOT_CONFIGURED');}
    const quote={...await createQuote(db,tenantId,req.body || {}),allowedChannels};
    if (quote.amount<=0) throw new BillingError(409,'ZERO_CHARGE_REQUIRES_SUPPORT');
    const origin=process.env.PUBLIC_APP_URL;
    if (!origin || !/^https:\/\//.test(origin)) throw new BillingError(503,'PUBLIC_APP_URL_NOT_CONFIGURED');
    const id=randomUUID(),invoiceNumber=`NH-${id}`;
    // Persist intent BEFORE external checkout. A fast webhook cannot outrun it.
    const result=await db.query(`INSERT INTO billing.invoices(id,subscription_id,tenant_id,amount,currency,due_date,invoice_number,quote,checkout_key)
      SELECT $1,id,tenant_id,$3,'IDR',now()+interval '24 hours',$4,$5::jsonb,$6 FROM billing.subscriptions
      WHERE tenant_id=$2 ON CONFLICT(tenant_id,checkout_key) DO NOTHING RETURNING *`,[id,tenantId,quote.amount,invoiceNumber,JSON.stringify(quote),key]);
    if(!result.rowCount){
      const existing=(await db.query('SELECT * FROM billing.invoices WHERE tenant_id=$1 AND checkout_key=$2',[tenantId,key])).rows[0];
      if(existing?.quote?.planId!==quote.planId || existing?.quote?.billingCycle!==quote.billingCycle || existing?.quote?.extraOutlets!==quote.extraOutlets) throw new BillingError(409,'CHECKOUT_KEY_CONFLICT');
      if(!existing.payment_link_url) throw new BillingError(409,'CHECKOUT_IN_PROGRESS_OR_NEEDS_REVIEW');
      return res.json({ok:true,paymentUrl:existing.payment_link_url,invoice:serializeInvoice(existing),quote:existing.quote,replayed:true});
    }
    try {
      const checkout=await checkoutProvider({order:{invoice_number:invoiceNumber,amount:quote.amount,currency:'IDR',
        callback_url:`${origin.replace(/\/$/,'')}/#settings?invoice=${id}`,auto_redirect:true,
        line_items:[{name:`${quote.planName} ${quote.billingCycle} + ${quote.extraOutlets} outlet`,price:quote.amount,quantity:1}]},payment:{payment_due_date:1440}});
      await db.query('UPDATE billing.invoices SET payment_link_url=$2 WHERE id=$1',[id,checkout.paymentUrl]);
      res.json({ok:true,paymentUrl:checkout.paymentUrl,invoice:serializeInvoice({...result.rows[0],payment_link_url:checkout.paymentUrl}),quote});
    } catch(err) {
      await db.query("UPDATE billing.invoices SET reconciliation_status='REVIEW',reconciliation_note='CHECKOUT_RESPONSE_FAILED' WHERE id=$1 AND payment_status<>'PAID'",[id]);
      throw err;
    }
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
    const issue=!channel || !channels.includes(channel)?'UNAPPROVED_PAYMENT_CHANNEL':!['SUCCESS','FAILED'].includes(status)?'UNKNOWN_PAYMENT_STATUS':undefined;
    const result=await reconcilePayment(db,{eventKey:String(req.headers['request-id'] || ''),
      invoiceNumber:invoice,reference:String(body?.transaction?.original_request_id || req.headers['request-id'] || '').slice(0,128),
      amount:Number(amount),currency:body?.order?.currency===undefined?'IDR':String(body.order.currency),success:status==='SUCCESS',
      channel,validationIssue:issue,contentDigest:generateDigest(raw),payload:{status,channel,requestTimestamp:req.headers['request-timestamp']}});
    res.json(result);
  }));
  app.all(DOKU_NOTIFICATION_PATH,(_req,res)=>res.set('Allow','POST').status(405).json({ok:false,error:'METHOD_NOT_ALLOWED'}));
}
