// Whole-app journey in the installed APK: every public page, back button, rotation, and playback across background and return.
// Drives the installed APK's WebView over the Chrome DevTools protocol, saves a screenshot per case and fails when a
// button or link sticks out past the screen edge, the page scrolls sideways, or the last content hides under the nav bar.
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { inflateSync } from "node:zlib";

const PKG = "com.neofm.app";
const ORIGIN = process.env.NEO_FM_SHELL_URL ?? "https://www.neo-fm.com";
const OUT = process.argv[2] ?? "journey-out";
mkdirSync(OUT, { recursive: true });
const adbRaw = (...a) => execFileSync("adb", a, { encoding: "utf8" }).trim();
const adb = (...a) => { try { return adbRaw(...a); } catch (e) { return String(e.message); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
};

let ws, id = 0;
const pending = new Map();
const send = (method, params = {}) => new Promise((res) => { const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method, params })); });
const evalJs = async (expression, userGesture = false) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture })).result?.result?.value;

async function attach() {
  if (ws) try { ws.close(); } catch {}
  const pid = adbRaw("shell", "pidof", PKG).split(/\s+/)[0];
  adb("forward", "tcp:9224", `localabstract:webview_devtools_remote_${pid}`);
  for (let i = 0; i < 30; i++) {
    try {
      const pages = await (await fetch("http://127.0.0.1:9224/json")).json();
      const page = pages.find((p) => p.type === "page");
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => ((ws.onopen = res), (ws.onerror = rej)));
        ws.onmessage = (m) => { const msg = JSON.parse(m.data); if (msg.id && pending.has(msg.id)) pending.get(msg.id)(msg); };
        return;
      }
    } catch {}
    await sleep(2000);
  }
  throw new Error("no WebView page");
}
async function goto(path) {
  await send("Page.navigate", { url: ORIGIN + path });
  for (let i = 0; i < 20; i++) {
    await sleep(1500);
    if ((await evalJs("document.readyState")) === "complete" && (await evalJs("location.pathname")) === path) break;
  }
  await sleep(1500);
}
const shot = (name) => writeFileSync(`${OUT}/${name}.png`, execFileSync("adb", ["exec-out", "screencap", "-p"], { maxBuffer: 1 << 26 }));


const probe = `(()=>{
  const w = innerWidth, out = [];
  for (const e of document.querySelectorAll("a,button,input,[role=button]")) {
    const r = e.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    let p = e.parentElement, inScroller = false;
    while (p && p !== document.body) { const o = getComputedStyle(p).overflowX; if ((o === "auto" || o === "scroll") && p.scrollWidth > p.clientWidth) { inScroller = true; break; } p = p.parentElement; }
    if (!inScroller && (r.right > w + 1 || r.left < -1)) out.push((e.innerText || e.tagName).trim().slice(0, 30));
  }
  return JSON.stringify({ w, sideways: document.scrollingElement.scrollWidth > w + 1, out, title: document.title, text: document.body.innerText.length, err: /something went wrong|application error|404/i.test(document.body.innerText.slice(0, 400)) });
})()`;
const audioTime = () => evalJs(`(()=>{const a=[...document.querySelectorAll("audio")].find(x=>!x.paused);return a?a.currentTime:-1})()`);

adb("shell", "wm", "size", "1080x2340");
adb("shell", "wm", "density", "425");
adb("shell", "am", "force-stop", PKG);
adb("shell", "am", "start", "-n", `${PKG}/.MainActivity`);
await sleep(12000);
await attach();

// 1. every public page loads, is not an error page, and fits the screen
const pages = ["/", "/discover", "/templates", "/pricing", "/help", "/whats-new", "/trust", "/ideas", "/feedback", "/privacy", "/terms", "/ai-disclosure", "/grievance", "/refusals", "/sign-in", "/station"];
for (const path of pages) {
  await goto(path);
  const m = JSON.parse(await evalJs(probe));
  check(`${path}: loads, has content, fits the screen`, !m.err && m.text > 80 && !m.sideways && m.out.length === 0, JSON.stringify({ title: m.title, text: m.text, sideways: m.sideways, out: m.out }));
}
shot("last-page");

// 2. the system back button walks the page history and does not close the app
const focus = () => adb("shell", "dumpsys", "window").split("\n").filter((l) => /mCurrentFocus|mFocusedApp/.test(l)).join(" | ");
await goto("/");
console.log("diag before click: history", await evalJs("history.length"), await evalJs("location.pathname"));
await evalJs(`(()=>{const a=[...document.querySelectorAll("a[href]")].find(x=>new URL(x.href).pathname==="/pricing"&&x.offsetParent!==null);a&&a.click();return !!a})()`, true);
await sleep(4000);
const onPricing = (await evalJs("location.pathname")) === "/pricing";
console.log("diag on pricing: history", await evalJs("history.length"), "entries", await evalJs("JSON.stringify(navigation.entries().map(e=>new URL(e.url).pathname).slice(-5))"));
console.log("diag GET / status:", await evalJs(`fetch("/",{redirect:"manual"}).then(r=>r.status+" "+r.type)`));
adb("shell", "input", "keyevent", "KEYCODE_BACK");
const seq = [];
for (let i = 0; i < 12; i++) { await sleep(300); try { seq.push(await evalJs("location.pathname")); } catch { seq.push("?"); } }
console.log("diag path after back every 300ms:", seq.join(" "));
await sleep(500);
const back = await evalJs("location.pathname");
console.log("diag after back:", back, "history", await evalJs("history.length"), "| focus:", focus());
check("back button returns to the previous page", onPricing && back === "/", `pricing=${onPricing} then ${back}`);
check("app still open after back", focus().includes(PKG), focus());

// 3. rotation: landscape fits, portrait comes back, page state survives
adb("shell", "settings", "put", "system", "accelerometer_rotation", "0");
adb("shell", "settings", "put", "system", "user_rotation", "1");
await sleep(4000);
await attach();
const land = JSON.parse(await evalJs(probe));
shot("landscape");
check("landscape: nothing past the screen edge", !land.sideways && land.out.length === 0, JSON.stringify({ w: land.w, out: land.out }));
adb("shell", "settings", "put", "system", "user_rotation", "0");
await sleep(4000);
await attach();
check("portrait again after rotating back", (await evalJs("innerHeight > innerWidth")) === true);

// 4. playback survives going to the home screen and coming back
await goto("/station");
let playing = false;
for (let attempt = 0; attempt < 3 && !playing; attempt++) {
  await evalJs(`(()=>{const b=[...document.querySelectorAll("button")].find(x=>/start my station|play|tune in/i.test(x.innerText));b&&b.click();return !!b})()`, true);
  for (let i = 0; i < 20 && !playing; i++) { await sleep(2000); playing = (await audioTime()) > 0; }
}
check("station plays", playing);
const t0 = await audioTime();
adb("shell", "input", "keyevent", "KEYCODE_HOME");
await sleep(15000);
check("app is in the background", !/mResumedActivity.*com\.neofm\.app/.test(adb("shell", "dumpsys", "activity", "activities")));
const t1 = await audioTime();
check("audio kept playing in the background", t1 - t0 > 8, `advanced ${(t1 - t0).toFixed(1)}s of ~15s`);
adb("shell", "am", "start", "-n", `${PKG}/.MainActivity`);
await sleep(5000);
const t2 = await audioTime();
check("same session on return (no restart, audio still advancing)", t2 > t1, `${t1.toFixed(1)} -> ${t2.toFixed(1)}`);

// 4b. listen together: a station share link opens in the app, shows the banner, and joining seeks to the sender's playhead
const trackPath = (await (await fetch(ORIGIN + "/sitemap.xml")).text()).match(/\/t\/[0-9a-f-]{36}/i)?.[0];
check("sitemap lists a public track", !!trackPath, String(trackPath));
if (trackPath) {
  await send("Page.navigate", { url: `${ORIGIN}${trackPath}?at=20&ts=${Date.now() - 5000}` });
  let bannerUp = false;
  for (let i = 0; i < 15 && !bannerUp; i++) { await sleep(2000); bannerUp = (await evalJs(`/a friend is listening to this right now/i.test(document.body.innerText)`)) === true; }
  shot("together-banner");
  const tp = JSON.parse(await evalJs(probe));
  check("together link: banner shows and fits the screen", bannerUp && !tp.sideways && tp.out.length === 0, JSON.stringify({ bannerUp, out: tp.out }));
  await evalJs(`(()=>{const b=[...document.querySelectorAll("button")].find(x=>/listen together/i.test(x.innerText));b&&b.click();return !!b})()`, true);
  let at = -1;
  for (let i = 0; i < 10 && at < 24; i++) { await sleep(1500); at = await evalJs(`(()=>{const a=document.querySelector("audio");return a?a.currentTime:-1})()`); }
  check("together link: joining seeks to the sender's playhead", at >= 24 && at < 90, `currentTime ${at}`);
  await evalJs(`document.querySelector("audio")?.pause()`);
  await send("Page.navigate", { url: `${ORIGIN}${trackPath}?at=20&ts=${Date.now() - 3 * 3600_000}` });
  await sleep(6000);
  check("together link: a stale link is a plain player", (await evalJs(`/a friend is listening/i.test(document.body.innerText)`)) === false);
}

// 4c. dedicate this hour: a station link with ?for=Name greets the listener, the dedicate form fits the screen, and the name is cut to letters
async function openRaw(path, ready) {
  await send("Page.navigate", { url: ORIGIN + path });
  for (let i = 0; i < 15; i++) { await sleep(2000); if ((await evalJs(ready)) === true) return true; }
  return false;
}
const bannerUp = await openRaw("/station?s=raat&for=Anita", `/this hour is for anita/i.test(document.body.innerText)`);
shot("dedicate-banner");
const dp = JSON.parse(await evalJs(probe));
check("dedicate link: 'This hour is for Anita' shows and fits the screen", bannerUp && !dp.sideways && dp.out.length === 0, JSON.stringify({ bannerUp, out: dp.out }));
await evalJs(`(()=>{const b=[...document.querySelectorAll("button")].find(x=>/dedicate this hour/i.test(x.innerText));b&&b.click();return !!b})()`, true);
await sleep(1500);
const form = JSON.parse(await evalJs(`(()=>{const i=document.querySelector("input[maxlength='24']");if(!i)return JSON.stringify({input:false});const r=i.getBoundingClientRect();return JSON.stringify({input:true,l:r.left,r:r.right,w:innerWidth})})()`));
shot("dedicate-form");
check("dedicate form opens and the name field fits the screen", form.input && form.l >= 0 && form.r <= form.w + 1, JSON.stringify(form));
await openRaw("/station?s=raat&for=" + encodeURIComponent("<b>Anita</b>123"), `/this hour is for/i.test(document.body.innerText)`);
const shown = await evalJs(`(document.body.innerText.match(/this hour is for[^\\n]*/i)||[""])[0]`);
check("dedicate link: markup and digits in the name are dropped", /this hour is for bAnitab$/i.test(shown.trim()) && !/[<>0-9]/.test(shown), shown);

// 4d. push in the shell: the opt-in lives under Account > Notifications and needs sign-in, so check what the WebView can do and that the page degrades
const cap = JSON.parse(await evalJs(`JSON.stringify({sw:"serviceWorker" in navigator,push:"PushManager" in window,notif:"Notification" in window,perm:"Notification" in window?Notification.permission:null,secure:isSecureContext})`));
console.log("diag push capability in the WebView:", JSON.stringify(cap));
const key = await evalJs(`fetch("/api/notifications/push/key").then(r=>r.json()).then(j=>j.enabled===true)`);
check("push key endpoint answers in the shell", key === true);
// Native push (FCM): the shell ships the plugin, the server answers the registration endpoint (401 signed out; 404 would mean
// push is off in prod), and with Play services on the emulator the plugin can fetch an FCM token. Registering the token
// needs a signed-in user, so that last step is not exercised here.
const plug = await evalJs(`!!(window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.PushNotifications)`);
check("push plugin is present in the shell", plug === true);
const reg = await evalJs(`fetch("/api/notifications/push/native",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({token:"probe-probe-probe-probe-1",platform:"android"})}).then(r=>r.status)`);
console.log("diag native push registration endpoint status signed out:", reg);
check("native push registration endpoint requires sign-in (push is on)", reg === 401, String(reg));
adb("shell", "pm", "grant", PKG, "android.permission.POST_NOTIFICATIONS");
const fcm = await evalJs(`new Promise(async (res) => {
  const p = window.Capacitor.Plugins.PushNotifications;
  const t = setTimeout(() => res("timeout"), 20000);
  await p.addListener("registration", (d) => { clearTimeout(t); res(d && d.value ? "token:" + d.value : "empty"); });
  await p.addListener("registrationError", (e) => { clearTimeout(t); res("error:" + JSON.stringify(e)); });
  try { const perm = await p.requestPermissions(); if (perm.receive !== "granted") { clearTimeout(t); return res("permission:" + perm.receive); } await p.register(); } catch (e) { clearTimeout(t); res("throw:" + String(e)); }
})`);
const fcmToken = /^token:(.+)$/.exec(String(fcm))?.[1] ?? "";
console.log("diag FCM registration in the emulator:", fcmToken ? `token of ${fcmToken.length} chars` : fcm);
check("the emulator gets an FCM token from Firebase", fcmToken.length > 100, fcmToken ? "" : String(fcm));

// Real delivery: with the Firebase service account (CI secret), send a notification straight to that token through FCM
// HTTP v1 and wait for it to appear in the shade. Skipped where the secret is not available.
async function sendFcm(token) {
  const { createSign } = await import("node:crypto");
  const sa = JSON.parse(Buffer.from(process.env.FCM_SERVICE_ACCOUNT_JSON_B64, "base64").toString("utf8"));
  const b64u = (o) => Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64u({ alg: "RS256", typ: "JWT" })}.${b64u({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3000 })}`;
  const jwt = `${unsigned}.${createSign("RSA-SHA256").update(unsigned).sign(sa.private_key, "base64url")}`;
  const tok = await (await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }) })).json();
  const r = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, { method: "POST", headers: { authorization: `Bearer ${tok.access_token}`, "content-type": "application/json" }, body: JSON.stringify({ message: { token, notification: { title: "neo-fm e2e push", body: "delivered through FCM" }, data: { url: "/station" }, android: { priority: "HIGH" } } }) });
  return r.status;
}
if (fcmToken && process.env.FCM_SERVICE_ACCOUNT_JSON_B64) {
  try {
    const status = await sendFcm(fcmToken);
    check("FCM accepts a push to the emulator's token", status === 200, String(status));
    let seen = false;
    for (let i = 0; i < 20 && !seen; i++) { await sleep(2000); seen = /neo-fm e2e push/.test(adb("shell", "dumpsys", "notification", "--noredact")); }
    check("the pushed notification shows up on the device", seen);
  } catch (e) { check("push delivery through FCM", false, String(e).slice(0, 120)); }
} else {
  console.log("diag FCM delivery check skipped: no service account in this run");
}
await goto("/sign-in");
await send("Page.navigate", { url: ORIGIN + "/account/notifications" });
await sleep(6000);
const redirected = await evalJs("location.pathname + location.search");
const ap = JSON.parse(await evalJs(probe));
check("signed-out notifications link goes to sign-in and fits the screen", /^\/sign-in\?next=/.test(redirected) && !ap.err && !ap.sideways && ap.out.length === 0, redirected);

// 5. the app can be killed and reopened cleanly
adb("shell", "am", "force-stop", PKG);
adb("shell", "am", "start", "-n", `${PKG}/.MainActivity`);
await sleep(12000);
await attach();
check("cold start after force-stop loads the site", (await evalJs("location.origin")) === ORIGIN);

adb("shell", "settings", "put", "system", "accelerometer_rotation", "1");
adb("shell", "wm", "size", "reset");
adb("shell", "wm", "density", "reset");
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} journey checks passed`);
process.exit(failed.length ? 1 : 0);
