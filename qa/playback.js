const { chromium } = require('playwright-core');
const { chromiumPath, base } = require('./common');
(async()=>{const b=await chromium.launch({executablePath:chromiumPath(),args:['--autoplay-policy=no-user-gesture-required']});
for(const [n,o] of [['desk',{viewport:{width:1280,height:800}}],['m390',{viewport:{width:390,height:844},isMobile:true,hasTouch:true}]]){
const c=await b.newContext(o);const p=await c.newPage();const fails=[];
p.on('requestfailed',r=>{if(/r2\.dev|track-url/.test(r.url()))fails.push(r.url().slice(-35)+' '+r.failure().errorText)});
const posts=[];p.on('request',r=>{if(/track-url|\/api\/station\/signal/.test(r.url()))posts.push(r.method()+' '+r.url().replace(base,'').slice(0,60))});
await p.goto(base+'/station',{waitUntil:'networkidle'});
await p.evaluate(async()=>{await navigator.serviceWorker.ready});
await p.reload({waitUntil:'networkidle'});
console.log(n,'sw',await p.evaluate(async()=>{const r=await navigator.serviceWorker.getRegistration();return {ctrl:!!navigator.serviceWorker.controller,active:r&&r.active&&r.active.scriptURL.slice(-12),caches:await caches.keys()}}));
await p.getByRole('button',{name:/Start my station/i}).click();
await p.waitForTimeout(7000);
const a=await p.evaluate(()=>[...document.querySelectorAll('audio')].map(a=>({src:a.currentSrc.slice(-28),t:+a.currentTime.toFixed(1),paused:a.paused,rs:a.readyState,err:a.error&&a.error.message})));
console.log(n,'audio',JSON.stringify(a));
const sk=p.getByRole('button',{name:/skip|next/i}).first();if(await sk.count()){await sk.click();await p.waitForTimeout(5000);
console.log(n,'after skip',JSON.stringify(await p.evaluate(()=>[...document.querySelectorAll('audio')].map(a=>({src:a.currentSrc.slice(-28),t:+a.currentTime.toFixed(1),paused:a.paused,err:a.error&&a.error.message})))))}
console.log(n,'fails',fails,'reqs',posts);
await c.close()}
await b.close()})();
