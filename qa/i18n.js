const { chromium } = require('playwright-core');
const { chromiumPath, base } = require('./common');
(async()=>{const b=await chromium.launch({executablePath:chromiumPath()});
for(const lang of ['hi','ta','te','kn','bn','mr']){
 for(const [n,o] of [['m360',{viewport:{width:360,height:740},isMobile:true,hasTouch:true}],['desk',{viewport:{width:1280,height:800}}]]){
  const c=await b.newContext(o);await c.addCookies([{name:'neo-fm-lang',value:lang,domain:new URL(base).hostname,path:'/'}]);
  for(const r of ['/','/station','/pricing','/sign-in','/help']){
   const p=await c.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message.slice(0,80)));
   await p.goto(base+r,{waitUntil:'load'});await p.waitForTimeout(900);
   const i=await p.evaluate(()=>{const t=document.body.innerText;const words=t.split(/\s+/).filter(w=>w.length>2);const lat=words.filter(w=>/^[A-Za-z'’.,-]+$/.test(w)).length;
    const raw=(t.match(/\b[a-z]+(\.[a-z][A-Za-z]+){1,3}\b/g)||[]).slice(0,3);
    const nonLatin=(t.match(/[ऀ-෿ঀ-৿]/g)||[]).length;
    return {lang:document.documentElement.lang,words:words.length,latinPct:Math.round(100*lat/Math.max(words.length,1)),nonLatin,raw,ovf:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,h1:(document.querySelector('h1')||{}).innerText?.slice(0,50)}});
   console.log(lang,n,r,JSON.stringify(i),errs.length?errs:'');
   if(n==='m360'&&r==='/'){await p.screenshot({path:`i18n-${lang}.png`})}
   await p.close()}
  await c.close()}}
await b.close()})();
