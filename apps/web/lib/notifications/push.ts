/**
 * Web Push (RFC 8030 delivery, RFC 8291 aes128gcm encryption, RFC 8292 VAPID)
 * on node:crypto only: no extra dependency. Off unless NEO_FM_WEB_PUSH_ENABLED=true
 * AND the three VAPID values are set; every caller goes through `pushConfig()`.
 */
import {
  createCipheriv,
  createECDH,
  createPrivateKey,
  hkdfSync,
  randomBytes,
  sign,
} from "node:crypto";

export interface PushConfig {
  publicKey: string; // base64url, 65-byte uncompressed P-256 point
  privateKey: string; // base64url, 32-byte scalar
  subject: string; // mailto: or https: contact
}

export interface PushSubscriptionLike {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export function pushConfig(env: NodeJS.ProcessEnv = process.env): PushConfig | null {
  if (env.NEO_FM_WEB_PUSH_ENABLED !== "true") return null;
  const publicKey = (env.VAPID_PUBLIC_KEY ?? "").trim();
  const privateKey = (env.VAPID_PRIVATE_KEY ?? "").trim();
  const subject = (env.VAPID_SUBJECT ?? "").trim();
  if (!publicKey || !privateKey || !/^(mailto:|https:\/\/)/.test(subject)) return null;
  if (b64uDecode(publicKey).length !== 65 || b64uDecode(privateKey).length !== 32) return null;
  return { publicKey, privateKey, subject };
}

export const b64uEncode = (b: Buffer | Uint8Array): string => Buffer.from(b).toString("base64url");
export const b64uDecode = (s: string): Buffer => Buffer.from(s, "base64url");

/** Push services we are willing to POST to. The endpoint comes from the browser, so it must not be an SSRF vector. */
const PUSH_HOSTS = [
  /(^|\.)fcm\.googleapis\.com$/,
  /(^|\.)push\.services\.mozilla\.com$/,
  /(^|\.)push\.apple\.com$/,
  /(^|\.)notify\.windows\.com$/,
];

export function isAllowedEndpoint(endpoint: string): boolean {
  try {
    const u = new URL(endpoint);
    return u.protocol === "https:" && !u.port && !u.username && !u.password && PUSH_HOSTS.some((re) => re.test(u.hostname));
  } catch {
    return false;
  }
}

/** RFC 8291 section 3: encrypt `payload` for one subscription. `ephemeral`/`salt` are injectable for the RFC test vector. */
export function encryptPayload(
  sub: Pick<PushSubscriptionLike, "p256dh" | "auth">,
  payload: Buffer,
  opts: { ephemeral?: ReturnType<typeof createECDH>; salt?: Buffer } = {},
): Buffer {
  const uaPublic = b64uDecode(sub.p256dh);
  const authSecret = b64uDecode(sub.auth);
  const ecdh = opts.ephemeral ?? (() => {
    const e = createECDH("prime256v1");
    e.generateKeys();
    return e;
  })();
  const asPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPublic);
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]);
  const ikm = Buffer.from(hkdfSync("sha256", shared, authSecret, keyInfo, 32));
  const salt = opts.salt ?? randomBytes(16);
  const cek = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  // Single record: payload || 0x02 delimiter (no padding).
  const ct = Buffer.concat([cipher.update(Buffer.concat([payload, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21 + asPublic.length);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header[20] = asPublic.length;
  asPublic.copy(header, 21);
  return Buffer.concat([header, ct]);
}

/** RFC 8292 VAPID JWT (ES256) for the push service's origin. */
export function vapidJwt(cfg: PushConfig, audience: string, now = Date.now()): string {
  const pub = b64uDecode(cfg.publicKey);
  const key = createPrivateKey({
    key: { kty: "EC", crv: "P-256", d: cfg.privateKey, x: b64uEncode(pub.subarray(1, 33)), y: b64uEncode(pub.subarray(33, 65)) },
    format: "jwk",
  });
  const enc = (o: unknown) => b64uEncode(Buffer.from(JSON.stringify(o)));
  const input = `${enc({ typ: "JWT", alg: "ES256" })}.${enc({ aud: audience, exp: Math.floor(now / 1000) + 12 * 3600, sub: cfg.subject })}`;
  const sig = sign("sha256", Buffer.from(input), { key, dsaEncoding: "ieee-p1363" });
  return `${input}.${b64uEncode(sig)}`;
}

export type PushResult = "sent" | "gone" | "failed";

/** Sends one push. 404/410 mean the subscription is dead and should be deleted. */
export async function sendPush(
  cfg: PushConfig,
  sub: PushSubscriptionLike,
  message: { title: string; body?: string; url: string; tag?: string },
  f: typeof fetch = fetch,
): Promise<PushResult> {
  if (!isAllowedEndpoint(sub.endpoint)) return "gone";
  const body = encryptPayload(sub, Buffer.from(JSON.stringify(message)));
  const audience = new URL(sub.endpoint).origin;
  try {
    const res = await f(sub.endpoint, {
      method: "POST",
      headers: {
        authorization: `vapid t=${vapidJwt(cfg, audience)}, k=${cfg.publicKey}`,
        "content-encoding": "aes128gcm",
        "content-type": "application/octet-stream",
        ttl: "86400",
        urgency: "normal",
      },
      body: new Uint8Array(body),
    });
    if (res.status === 404 || res.status === 410) return "gone";
    return res.ok ? "sent" : "failed";
  } catch {
    return "failed";
  }
}
