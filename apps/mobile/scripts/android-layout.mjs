// Layout check on a Galaxy S22 sized screen (1080x2340, 425 dpi) at several system text sizes and both navigation modes.
// Drives the installed APK's WebView over the Chrome DevTools protocol, saves a screenshot per case and fails when a
// button or link sticks out past the screen edge, the page scrolls sideways, or the last content hides under the nav bar.
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { inflateSync } from "node:zlib";

const PKG = "com.neofm.app";
const ORIGIN = process.env.NEO_FM_SHELL_URL ?? "https://www.neo-fm.com";
const OUT = process.argv[2] ?? "layout-out";
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
  adb("forward", "tcp:9223", `localabstract:webview_devtools_remote_${pid}`);
  for (let i = 0; i < 30; i++) {
    try {
      const pages = await (await fetch("http://127.0.0.1:9223/json")).json();
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

// returns controls whose box leaves the viewport sideways, and whether the page scrolls sideways
const probe = `(()=>{
  const w = window.innerWidth, h = window.innerHeight;
  const out = [];
  for (const e of document.querySelectorAll("a,button,input,[role=button]")) {
    const r = e.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const cs = getComputedStyle(e);
    if (cs.visibility === "hidden" || cs.display === "none") continue;
    // skip controls inside a horizontally scrolling strip (they are meant to scroll)
    let p = e.parentElement, inScroller = false;
    while (p && p !== document.body) { const o = getComputedStyle(p).overflowX; if ((o === "auto" || o === "scroll") && p.scrollWidth > p.clientWidth) { inScroller = true; break; } p = p.parentElement; }
    if (inScroller) continue;
    if (r.right > w + 1 || r.left < -1) out.push((e.innerText || e.getAttribute("aria-label") || e.tagName).trim().slice(0, 30) + " @" + Math.round(r.left) + ".." + Math.round(r.right));
  }
  const root = document.scrollingElement;
  return JSON.stringify({ w, h, dpr: window.devicePixelRatio, sideways: root.scrollWidth > w + 1, scrollW: root.scrollWidth, out });
})()`;

// native side: where the WebView sits on the physical screen (uiautomator bounds), and whether the status bar strip is clean
function webViewBounds() {
  adb("shell", "uiautomator", "dump", "/sdcard/ui.xml");
  const xml = adb("shell", "cat", "/sdcard/ui.xml");
  const m = /class="android\.webkit\.WebView"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(xml);
  return m ? { l: +m[1], t: +m[2], r: +m[3], b: +m[4] } : null;
}
function decodePng(buf) {
  let o = 8, w = 0, h = 0; const idat = [];
  while (o < buf.length) {
    const len = buf.readUInt32BE(o), type = buf.toString("ascii", o + 4, o + 8);
    if (type === "IHDR") { w = buf.readUInt32BE(o + 8); h = buf.readUInt32BE(o + 12); }
    if (type === "IDAT") idat.push(buf.subarray(o + 8, o + 8 + len));
    o += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat)), bpp = 4, stride = w * bpp, px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x], a = x >= bpp ? px[y * stride + x - bpp] : 0, b = y ? px[(y - 1) * stride + x] : 0, c = x >= bpp && y ? px[(y - 1) * stride + x - bpp] : 0;
      const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
      px[y * stride + x] = (v + (f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
    }
  }
  return { w, h, px };
}
const wmSize = (s) => adb("shell", "wm", "size", s);
adb("shell", "wm", "size", "1080x2340");
adb("shell", "wm", "density", "425");
adb("shell", "settings", "put", "global", "window_animation_scale", "0");

const cases = [];
for (const nav of ["gestural", "threebutton"]) for (const font of ["1.0", "1.3"]) cases.push({ nav, font });
const pages = ["/", "/station", "/pricing", "/sign-in"];

for (const { nav, font } of cases) {
  adb("shell", "cmd", "overlay", "enable-exclusive", `com.android.internal.systemui.navbar.${nav}`);
  adb("shell", "settings", "put", "system", "font_scale", font);
  adb("shell", "am", "force-stop", PKG);
  adb("shell", "am", "start", "-n", `${PKG}/.MainActivity`);
  await sleep(12000);
  await attach();
  {
    const wv = webViewBounds();
    const tag = `${nav}-f${font}`;
    check(`${tag}: WebView sits below the status bar and above the nav bar`, !!wv && wv.t >= 40 && wv.b <= 2340 - (nav === "threebutton" ? 40 : 0) && wv.l === 0 && wv.r === 1080, JSON.stringify(wv));
    const img = decodePng(execFileSync("adb", ["exec-out", "screencap", "-p"], { maxBuffer: 1 << 26 }));
    // the strip above the WebView must be one flat colour: page content drawn under the clock/icons shows as extra colours
    const colours = new Set();
    for (let y = 0; y < Math.min(wv?.t ?? 0, 100) - 30; y += 3) for (let x = 0; x < img.w; x += 4) { const i = y * img.w * 4 + x * 4; colours.add(`${img.px[i] >> 4},${img.px[i + 1] >> 4},${img.px[i + 2] >> 4}`); }
    console.log(`diag ${tag}: ${colours.size} colours in the strip above the WebView`);
  }
  for (const path of pages) {
    await goto(path);
    const tag = `${nav}-f${font}-${path === "/" ? "home" : path.slice(1)}`;
    const top = JSON.parse(await evalJs(probe));
    shot(`${tag}-top`);
    check(`${tag}: no control past the screen edge, no sideways scroll`, !top.sideways && top.out.length === 0, JSON.stringify({ w: top.w, scrollW: top.scrollW, out: top.out }));
    // scroll to the bottom: the last content must end above the bottom edge of the visible area
    await evalJs("window.scrollTo(0, document.scrollingElement.scrollHeight)");
    await sleep(800);
    const bottom = JSON.parse(await evalJs(`(()=>{const h=window.innerHeight;const els=[...document.body.querySelectorAll("*")].filter(e=>{const r=e.getBoundingClientRect();return r.height>0&&r.width>0&&getComputedStyle(e).position!=="fixed"&&e.children.length===0&&(e.innerText||"").trim()});const last=els.map(e=>e.getBoundingClientRect().bottom).filter(b=>b>0).sort((a,b)=>b-a)[0]??0;return JSON.stringify({h,last:Math.round(last)})})()`));
    shot(`${tag}-bottom`);
    check(`${tag}: last content inside the visible area`, bottom.last <= bottom.h, JSON.stringify(bottom));
  }
}
adb("shell", "settings", "put", "system", "font_scale", "1.0");
wmSize("reset");
adb("shell", "wm", "density", "reset");
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} layout checks passed`);
process.exit(failed.length ? 1 : 0);
