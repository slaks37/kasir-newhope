// Isolated browser fixtures only. All API requests are intercepted; no cloud writes.
import assert from 'node:assert/strict';
import { INITIAL_SETTINGS } from '../../src/data/initialData';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const ownerId='11111111-1111-4111-8111-111111111111';
const branchId='22222222-2222-4222-8222-222222222222';
const secondBranch='33333333-3333-4333-8333-333333333333';
const owner={id:ownerId,name:'Owner Uji',username:'owner',role:'ADMIN',pin:'test-only',email:'owner@test.invalid',status:'ACTIVE'};
const authUser={id:ownerId,email:owner.email,aud:'authenticated',created_at:'2026-01-01T00:00:00Z',app_metadata:{},user_metadata:{full_name:owner.name,store_name:'Toko Uji',business_sector:'FNB'}};
const subscription:any={id:'test-sub',tenantId:ownerId,planId:'plan-free-lifetime',status:'FREE',isActive:true,accessMode:'FULL',hasUsedTrial:true,currentPeriodStart:'2026-01-01T00:00:00Z',currentPeriodEnd:'2026-02-15T00:00:00Z',cancelAtPeriodEnd:false};
const products=Array.from({length:12},(_,i)=>({id:'p'+i,name:'Produk '+(i+1),sku:'SKU'+i,categoryId:'test-category',price:10000,costPrice:4000,stock:50,minStockAlert:1,unit:'pcs',isAvailable:true}));
const branches=[{id:branchId,name:'Cabang Utama',businessSector:'FNB',isActive:true},{id:secondBranch,name:'Cabang Kedua',businessSector:'FNB',isActive:true}];
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 const errors:string[]=[];page.on('pageerror',(e:Error)=>errors.push(e.message));
 await page.route('**/api/**',async(route:any)=>{
   const path=new URL(route.request().url()).pathname;
   if(path.endsWith('/free-plan')) {
     const selection=route.request().postDataJSON();
     if(selection.branchId===secondBranch) return route.fulfill({status:409,json:{ok:false,error:'FREE_PRODUCT_BRANCH_MISMATCH'}});
     subscription.freeSelection=selection;
     return route.fulfill({json:{ok:true,subscription}});
   }
   if(path.endsWith('/outlets'))return route.fulfill({json:{ok:true,rows:branches.map(b=>({id:b.id,name:b.name,is_active:true,business_sector:'FNB'}))}});
   if(path.endsWith('/status'))return route.fulfill({json:{ok:true,subscription,plan:{name:'Free Selamanya'},outlets:{used:1,limit:1,included:1,extra:0},invoices:[],accessMode:'FULL',daysLeft:0,requiresRenewal:false}});
   return route.fulfill({json:{ok:true,rows:[],accepted:0}});
 });
 await page.addInitScript(({owner,authUser,subscription,products,branches,initial}:any)=>{
   localStorage.setItem('nhpos_local_session',JSON.stringify({user:authUser,session:{user:authUser,access_token:'local-ui-fixture'}}));
   localStorage.setItem('newhope_current_user',JSON.stringify(owner));
   localStorage.setItem('newhope_users',JSON.stringify([owner]));
   localStorage.setItem(`newhope_user_${owner.id}_settings`,JSON.stringify({...initial,storeName:'Toko Uji',businessSector:'FNB',subscription,branches,activeBranchId:branches[0].id}));
   localStorage.setItem(`newhope_data_${owner.id}_FNB_products`,JSON.stringify(products));
   localStorage.setItem(`newhope_data_${owner.id}_FNB_categories`,JSON.stringify([{id:'test-category',name:'Produk',icon:'ShoppingBag'}]));
 },{owner,authUser,subscription,products,branches,initial:INITIAL_SETTINGS});
 await page.goto(process.env.UI_BASE_URL || 'http://127.0.0.1:4177/#pos');
 const dialog=page.getByRole('dialog',{name:'Free selamanya — pilih yang tetap aktif'});
 await dialog.waitFor();
 await dialog.getByLabel('Cabang aktif').selectOption(branchId);
 for(let i=0;i<10;i++)await dialog.getByRole('checkbox').nth(i).check();
 assert.equal(await dialog.getByRole('checkbox').nth(10).isDisabled(),true);
 await page.screenshot({path:'/private/tmp/newhope-free-selection-desktop.png'});
 await dialog.getByRole('button',{name:'Simpan pilihan Free'}).click();
 await dialog.waitFor({state:'hidden'});
 const kasir=page.locator('.nh-sidebar-item').filter({hasText:/Kasir/}).first();
 await kasir.click();
 await page.getByRole('heading',{name:'Kasir',exact:true}).waitFor();
 assert.equal(await page.getByText('Produk 11',{exact:true}).count(),0);
 assert.equal(await page.getByText('Produk 12',{exact:true}).count(),0);
 assert.equal(await page.getByRole('button',{name:'Semua Menu (10)',exact:true}).count(),1);
 assert.equal(await page.getByRole('button',{name:/Paket Bundling/}).count(),0);
 await page.screenshot({path:'/private/tmp/newhope-free-pos-desktop.png'});
 await page.getByRole('button',{name:'Ubah pilihan',exact:true}).click();
 await dialog.getByLabel('Cabang aktif').selectOption(secondBranch);
 await dialog.getByRole('button',{name:'Simpan pilihan Free'}).click();
 await dialog.getByRole('alert').filter({hasText:'cabang lain'}).waitFor();
 await dialog.getByRole('button',{name:'Batal',exact:true}).click();
 await page.locator('.nh-sidebar-item').filter({hasText:/Pembayaran|Langganan/}).first().click();
 await page.getByRole('heading',{name:'Pilih Paket Layanan',exact:true}).waitFor();
 await page.getByText('Free selamanya',{exact:true}).waitFor();
 await page.screenshot({path:'/private/tmp/newhope-payment-light-desktop.png',fullPage:true});
 const panel=page.locator('.nh-light-panel').first();
 assert.equal(await panel.evaluate((el:Element)=>getComputedStyle(el).backgroundColor),'rgb(255, 255, 255)');
 await page.setViewportSize({width:390,height:844});
 await page.screenshot({path:'/private/tmp/newhope-payment-light-mobile.png',fullPage:true});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 assert.deepEqual(errors,[]);
 console.log('PASS: Free selection 10/12 cap, data-preserving POS filter, branch error, desktop/mobile light payment and no runtime errors');
} finally {await browser.close();}
