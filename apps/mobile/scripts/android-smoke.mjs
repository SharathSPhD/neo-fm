// Drives the installed debug APK's WebView over the Chrome DevTools protocol (adb-forwarded) and checks the things a
// 24/7 station app must get right. Run by .github/workflows/mobile-android.yml via emulator-smoke.sh. Node 22 (global WebSocket).
import { execFileSync } from "node:child_process";

const PKG = "com.neofm.app";
const ORIGIN = process.env.NEO_FM_SHELL_URL ?? "https://www.neo-fm.com";
const adb = (...a) => execFileSync("adb", a, { encoding: "utf8" }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
};

async function connect() {
  const pid = adb("shell", "pidof", PKG).split(/\s+/)[0];
  adb("forward", "tcp:9222", `localabstract:webview_devtools_remote_${pid}`);
  for (let i = 0; i < 30; i++) {
    try {
      const pages = await (await fetch("http://127.0.0.1:9222/json")).json();
      const page = pages.find((p) => p.type === "page" && p.url.startsWith(ORIGIN)) ?? pages.find((p) => p.type === "page");
      if (page) return page;
    } catch {}
    await sleep(2000);
  }
  throw new Error("no WebView page over DevTools");
}

const page = await connect();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => ((ws.onopen = res), (ws.onerror = rej)));
let id = 0;
const pending = new Map();
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) pending.get(msg.id)(msg);
};
const send = (method, params = {}) =>
  new Promise((res) => {
    const n = ++id;
    pending.set(n, res);
    ws.send(JSON.stringify({ id: n, method, params }));
  });
const evalJs = async (expression, userGesture = false) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture });
  return r.result?.result?.value;
};
async function goto(path) {
  await send("Page.navigate", { url: ORIGIN + path });
  for (let i = 0; i < 30; i++) {
    await sleep(1500);
    if ((await evalJs("document.readyState")) === "complete" && (await evalJs("location.pathname")) === path) return;
  }
}

// 1. the shell loads the live site and identifies itself
await goto("/station");
check("loads live origin", (await evalJs("location.origin")) === ORIGIN);
check("shell user agent", /NeoFmApp\/\S+ \(android\)/.test(await evalJs("navigator.userAgent")));
check("capacitor bridge injected", (await evalJs("typeof window.Capacitor?.registerPlugin")) === "function");

// 2. no purchase UI, and the server refuses checkout for the shell UA
await goto("/pricing");
const buyButtons = await evalJs(`[...document.querySelectorAll("button,a")].map(e=>e.innerText).filter(t=>/^(upgrade|buy|subscribe|get creator|get pro)/i.test(t.trim())).length`);
check("no purchase buttons on /pricing", buyButtons === 0, `found ${buyButtons}`);
const checkoutStatus = await evalJs(`fetch("/api/billing/checkout",{method:"POST",headers:{"content-type":"application/json"},body:"{}"}).then(r=>r.status)`);
check("checkout refused for the app (403)", checkoutStatus === 403, `status ${checkoutStatus}`);
await goto("/sign-in");
check("no Google sign-in in the app", !/continue with google/i.test(await evalJs("document.body.innerText")));

// 3. the station plays
await goto("/station");
const audioTime = () => evalJs(`(()=>{const a=[...document.querySelectorAll("audio")].find(x=>!x.paused);return a?a.currentTime:-1})()`);
let playing = false;
for (let attempt = 0; attempt < 3 && !playing; attempt++) {
  await evalJs(`(()=>{const b=[...document.querySelectorAll("button")].find(x=>/start my station|play|tune in/i.test(x.innerText));b&&b.click();return !!b})()`, true);
  for (let i = 0; i < 20 && !playing; i++) {
    await sleep(2000);
    playing = (await audioTime()) > 0;
  }
}
check("station audio plays", playing);

// 4. media notification and session while playing
const notif = adb("shell", "dumpsys", "notification", "--noredact");
check("media notification posted", notif.includes(`pkg=${PKG}`) && /MediaStyle|media/i.test(notif.split(`pkg=${PKG}`)[1] ?? ""));
const session = adb("shell", "dumpsys", "media_session");
check("media session active", new RegExp(`${PKG}[\\s\\S]{0,600}state=PlaybackState \\{state=3`).test(session));

// 5. screen off: playback must continue
const before = await audioTime();
adb("shell", "input", "keyevent", "KEYCODE_SLEEP");
await sleep(15000);
const asleep = adb("shell", "dumpsys", "power").includes("mWakefulness=Asleep");
adb("shell", "input", "keyevent", "KEYCODE_WAKEUP");
await sleep(2000);
const after = await audioTime();
check("screen went off", asleep);
check("audio kept playing with the screen off", before >= 0 && after - before > 8, `advanced ${(after - before).toFixed(1)}s of ~17s`);

ws.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
