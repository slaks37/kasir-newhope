import assert from 'node:assert/strict';import fs from 'node:fs';import {spawn} from 'node:child_process';import {chromium} from 'playwright';
fs.mkdirSync('build/qris',{recursive:true});const child=spawn(process.execPath,['--import','tsx','scripts/payments/browser-fixture.ts'],{stdio:['ignore','pipe','pipe']});let output='',browser;
const log=fs.createWriteStream('build/qris/browser-fixture.log');child.stdout.on('data',b=>output+=b);child.stdout.pipe(log);child.stderr.pipe(log);
try{
 let base;for(let i=0;i<100;i++){base=output.match(/QRIS_FIXTURE=(http:\/\/127.0.0.1:\d+)/)?.[1];if(base)break;if(child.exitCode!==null)throw Error('FIXTURE_EXITED');await new Promise(r=>setTimeout(r,200));}assert.ok(base,'fixture ready');
 browser=await chromium.launch({headless:true,executablePath:process.env.QRIS_BROWSER_EXECUTABLE||undefined});const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 let invoice;await page.route('**/api/v1/subscription/checkout',async r=>{const response=await r.fetch();const returned=(await response.json()).invoice;if(returned)invoice=returned;await r.fulfill({response});});
 await page.route('https://sandbox.doku.com/**',r=>r.fulfill({contentType:'text/html',body:'<h1>PROVIDER MOCK — NO PAYMENT</h1>'}));
 await page.goto(base);await page.getByRole('heading',{name:'Langganan & outlet'}).waitFor();await page.getByLabel('Periode langganan',{exact:true}).selectOption('MONTHLY');
 await page.getByRole('button',{name:'Hitung tagihan / ubah paket'}).first().click();await page.getByRole('button',{name:'Lanjut pembayaran DOKU'}).waitFor();
 await page.getByRole('button',{name:'Lanjut pembayaran DOKU'}).click();
 await page.waitForURL('https://sandbox.doku.com/**');await page.goto(base);await page.getByLabel('Periode langganan',{exact:true}).selectOption('MONTHLY');await page.getByRole('button',{name:'Hitung tagihan / ubah paket'}).first().click();await page.getByRole('button',{name:'Lanjut pembayaran DOKU'}).click();await page.waitForURL('https://sandbox.doku.com/**');
 const metrics=await (await fetch(base+'/__fixture/metrics')).json();assert.equal(metrics.calls,1);assert.equal(metrics.invoices,1);

 await page.clock.install();let verifyRequests=0,inquiryRequests=0;
 page.on('request',r=>{if(r.url().includes('/api/v1/subscription/verify')){verifyRequests++;if(r.url().includes('inquire=1'))inquiryRequests++;}});
 await page.goto(base+'/subscription?invoice='+invoice.id);await page.getByText('Pembayaran belum terkonfirmasi.',{exact:false}).waitFor();assert.equal(await page.getByText('Pembayaran Berhasil Dikonfirmasi',{exact:true}).count(),0);
 await page.screenshot({animations:'disabled',path:'build/qris/browser-pending.png',fullPage:true});

 for(let i=0;i<3;i++)await Promise.all([page.waitForResponse(r=>r.url().includes('/api/v1/subscription/verify')&&r.url().includes('inquire=1')),page.clock.fastForward(60000)]);
 assert.equal(verifyRequests,4);assert.equal(inquiryRequests,3);await page.clock.fastForward(120000);assert.equal(verifyRequests,4);
 assert.equal((await(await fetch(base+'/__fixture/metrics')).json()).inquiries,0,'virtual browser clock cannot bypass real server cooldown');
 assert.equal((await fetch(base+'/__fixture/deliver',{method:'POST',headers:{'content-type':'application/json'},body:'{"expire":true}'})).status,200);
 const oldId=invoice.id;await page.goto(base);assert.equal(await page.getByRole('row').filter({hasText:invoice.invoiceNumber}).getByRole('link',{name:'Buka tagihan'}).count(),0);
 await page.getByLabel('Periode langganan',{exact:true}).selectOption('MONTHLY');await page.getByRole('button',{name:'Hitung tagihan / ubah paket'}).first().click();await page.getByRole('button',{name:'Lanjut pembayaran DOKU'}).click();
 await page.getByRole('alert').filter({hasText:'CHECKOUT_EXPIRED'}).waitFor();
 await page.getByRole('button',{name:'Hitung tagihan / ubah paket'}).first().click();await page.getByRole('button',{name:'Lanjut pembayaran DOKU'}).click();await page.waitForURL('https://sandbox.doku.com/**');assert.notEqual(invoice.id,oldId);
 await page.goto(base+'/subscription?invoice='+invoice.id);
 assert.equal((await fetch(base+'/__fixture/deliver',{method:'POST'})).status,200);await page.reload();await page.getByText('Pembayaran Berhasil Dikonfirmasi',{exact:true}).waitFor();await page.screenshot({animations:'disabled',path:'build/qris/browser-paid.png',fullPage:true});
 const legacy=await(await fetch(base+'/__fixture/legacy',{method:'POST'})).json();
 const history=await(await fetch(base+'/api/v1/subscription/status')).json();assert.equal(history.invoices.find(i=>i.id===legacy.id).paymentLinkUrl,null);
 await page.goto(base);assert.equal(await page.getByRole('row').filter({hasText:legacy.invoiceNumber}).getByRole('link',{name:'Buka tagihan'}).count(),0);
 await fetch(base+'/__fixture/quote-off',{method:'POST'});await page.goto(base+'/subscription');await page.getByText('Tagihan belum dapat dihitung oleh server. Coba lagi saat online.',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Bayar Sekarang dengan DOKU Checkout'}).isDisabled(),true);
 await page.setViewportSize({width:390,height:844});await page.screenshot({animations:'disabled',path:'build/qris/browser-quote-unavailable-mobile.png',fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 assert.deepEqual(errors,[]);fs.writeFileSync('build/qris/browser-result.json',JSON.stringify({result:'PASS',provider:'MOCK',authentication:'SYNTHETIC_CONTEXT_ONLY',checks:['server quote','hosted redirect','refresh replay one invoice','active subscription not proof of invoice payment','signed webhook fulfillment','paid confirmation','quote outage fail closed','mobile no horizontal overflow','zero page errors','legacy mixed-channel history has no payment action','callback inquiry polling is bounded and delayed','provider-expired intent replaced through safe retry'],realPayment:false},null,2));console.log('PASS browser: 12 desktop/mobile QRIS billing checks (synthetic Auth/provider, isolated PostgreSQL)');
}finally{await browser?.close();child.kill('SIGTERM');}
