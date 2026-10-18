const KEY = "neo-fm:whats-new-seen";
const EVENT = "neo-fm:whats-new-seen-change";

export function readSeen(): string | null {
  try { return window.localStorage.getItem(KEY); } catch { return null; }
}

export function markSeen(id: string): void {
  try { window.localStorage.setItem(KEY, id); } catch { /* best effort */ }
  window.dispatchEvent(new Event(EVENT));
}

export function subscribeSeen(cb: () => void): () => void {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => { window.removeEventListener(EVENT, cb); window.removeEventListener("storage", cb); };
}
