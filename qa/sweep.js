const { chromium } = require('playwright-core');
const { chromiumPath, base } = require('./common');
const B=base;
const routes=['/','/station','/pricing','/discover','/templates','/ideas','/help','/trust','/whats-new','/feedback','/refusals','/terms','/privacy','/grievance','/ai-disclosure','/sign-in','/sign-up','/offline','/ai-songs/hindi','/ai-songs/tamil','/ai-songs/kannada','/library','/songs/new','/account','/gift','/nope-404','/sitemap.xml'];
(async()=>{
 const b=await chromium.launch({executablePath:chromiumPath()});
 for(const [n,o] of [['desk',{viewport:{width:1280,height:800}}],['m390',{viewport:{width:390,height:844},isMobile:true,hasTouch:true}],['m360',{viewport:{width:360,height:740},isMobile:true,hasTouch:true}]]){
  const ctx=await b.newContext(o);
  for(const r of routes){
   if(n!=='desk' && /xml|txt|webmanifest|nope/.test(r)) continue;
   const p=await ctx.newPage(); const errs=[],bad=[];
   p.on('pageerror',e=>errs.push('pageerror '+e.message.slice(0,100)));
   p.on('console',m=>{if(m.type()==='error')errs.push('console '+m.text().slice(0,110))});
   p.on('response',x=>{if(x.status()>=400)bad.push(x.status()+' '+x.url().replace(B,'').slice(0,70))});
   let st='?';
   try{const res=await p.goto(B+r,{waitUntil:'load',timeout:30000}); st=res.status(); await p.waitForTimeout(1200);}catch(e){st='ERR '+e.message.slice(0,50)}
   const info=await p.evaluate(()=>{const d=document.documentElement;const q=s=>document.querySelector(s);
    const imgs=[...document.images].filter(i=>!i.hasAttribute('alt')).length;
    const small=[...document.querySelectorAll('a,button')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&(r.height<32||r.width<32)&&getComputedStyle(e).visibility!=='hidden'&&e.innerText?.trim()}).length;
    return {url:location.pathname,title:document.title.slice(0,50),lang:d.lang,h1:document.querySelectorAll('h1').length,ogimg:!!q('meta[property="og:image"]'),desc:!!q('meta[name=description]'),ovf:d.scrollWidth>d.clientWidth+1,noAlt:imgs,small,len:document.body.innerText.length}}).catch(()=>({}));
   if((st!==200&&!/nope/.test(r))||info.ovf||errs.length||bad.length&&!/nope/.test(r)||info.h1!==1||!info.title||info.title==='neo-fm'||['/','/discover','/ideas','/help'].includes(r)) console.log(n,r,st,JSON.stringify(info),errs.length?'ERRS:'+errs.slice(0,3).join(' | '):'',bad.length?'BAD:'+bad.slice(0,3).join(' | '):'');
   if(['/','/pricing','/discover','/sign-in'].includes(r)) await p.screenshot({path:`sw-${n}-${r.replace(/\W/g,'')||'home'}.png`,fullPage:false});
   await p.close();
  }
 }
 await b.close();
})();
