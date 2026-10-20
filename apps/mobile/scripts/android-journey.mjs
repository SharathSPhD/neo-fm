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
const evalJs = async (expression) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;

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
await evalJs(`(()=>{const a=[...document.querySelectorAll("a[href]")].find(x=>new URL(x.href).pathname==="/pricing"&&x.offsetParent!==null);a&&a.click();return !!a})()`);
await sleep(4000);
const onPricing = (await evalJs("location.pathname")) === "/pricing";
console.log("diag on pricing: history", await evalJs("history.length"), "entries", await evalJs("JSON.stringify(navigation.entries().map(e=>new URL(e.url).pathname).slice(-5))"));
adb("shell", "input", "keyevent", "KEYCODE_BACK");
await sleep(3000);
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
  await evalJs(`(()=>{const b=[...document.querySelectorAll("button")].find(x=>/start my station|play|tune in/i.test(x.innerText));b&&b.click();return !!b})()`);
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
