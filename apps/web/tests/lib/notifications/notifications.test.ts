import { createDecipheriv, createECDH, hkdfSync, randomBytes, verify, createPublicKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  applyPrefsPatch,
  MANDATORY_TYPES,
  NOTIFICATION_TYPES,
  PrefsPatchSchema,
  renderNotification,
  resolvePrefs,
} from "@/lib/notifications/types";
import { b64uDecode, b64uEncode, encryptPayload, isAllowedEndpoint, pushConfig, vapidJwt } from "@/lib/notifications/push";

describe("preferences", () => {
  it("defaults: everything in-app, push only for personal types", () => {
    const p = resolvePrefs(null);
    for (const t of NOTIFICATION_TYPES) expect(p[t].in_app).toBe(true);
    expect(p.song_ready.push).toBe(true);
    expect(p.like.push).toBe(false);
  });
  it("mandatory types cannot be switched off in-app", () => {
    const stored = applyPrefsPatch(null, { takedown: { in_app: false }, like: { in_app: false } });
    expect(stored.takedown!.in_app).toBe(true);
    expect(stored.like!.in_app).toBe(false);
    expect(MANDATORY_TYPES).toContain("takedown");
    expect(resolvePrefs({ takedown: { in_app: false } }).takedown.in_app).toBe(true);
  });
  it("rejects unknown types, unknown keys and empty patches", () => {
    expect(PrefsPatchSchema.safeParse({ nope: { push: true } }).success).toBe(false);
    expect(PrefsPatchSchema.safeParse({ like: { admin: true } }).success).toBe(false);
    expect(PrefsPatchSchema.safeParse({}).success).toBe(false);
    expect(PrefsPatchSchema.safeParse({ like: { push: true } }).success).toBe(true);
  });
});

describe("renderNotification", () => {
  it("folds counts and links only to same-origin paths", () => {
    const r = renderNotification({ type: "like", count: 3, data: { title: "Raat", job_id: "abc" } });
    expect(r.title).toContain("3 new likes");
    expect(r.href).toBe("/songs/abc");
    for (const t of NOTIFICATION_TYPES) {
      const x = renderNotification({ type: t, count: 1, data: { title: "<img src=x>", job_id: "j", handle: "../evil", public_id: "p" } });
      expect(x.href.startsWith("/")).toBe(true);
      expect(x.href.startsWith("//")).toBe(false);
    }
  });
  it("ignores unsafe follower handles", () => {
    const r = renderNotification({ type: "follow", count: 1, data: { handle: "a/b?x" } });
    expect(r.href).toBe("/account");
  });
});

describe("web push", () => {
  const env = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;
  const keys = (() => {
    const e = createECDH("prime256v1");
    e.generateKeys();
    return { publicKey: b64uEncode(e.getPublicKey()), privateKey: b64uEncode(e.getPrivateKey()) };
  })();

  it("is off unless the flag and all VAPID values are set", () => {
    expect(pushConfig(env({}))).toBeNull();
    expect(pushConfig(env({ VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey, VAPID_SUBJECT: "mailto:a@b.co" }))).toBeNull();
    expect(pushConfig(env({ NEO_FM_WEB_PUSH_ENABLED: "true", VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey, VAPID_SUBJECT: "nope" }))).toBeNull();
    expect(pushConfig(env({ NEO_FM_WEB_PUSH_ENABLED: "true", VAPID_PUBLIC_KEY: "short", VAPID_PRIVATE_KEY: keys.privateKey, VAPID_SUBJECT: "mailto:a@b.co" }))).toBeNull();
    expect(pushConfig(env({ NEO_FM_WEB_PUSH_ENABLED: "true", VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey, VAPID_SUBJECT: "mailto:a@b.co" }))).not.toBeNull();
  });

  it("only allows known push services over plain https", () => {
    expect(isAllowedEndpoint("https://fcm.googleapis.com/fcm/send/abc")).toBe(true);
    expect(isAllowedEndpoint("https://updates.push.services.mozilla.com/wpush/v2/x")).toBe(true);
    expect(isAllowedEndpoint("http://fcm.googleapis.com/x")).toBe(false);
    expect(isAllowedEndpoint("https://fcm.googleapis.com.evil.com/x")).toBe(false);
    expect(isAllowedEndpoint("https://evil.com/fcm.googleapis.com")).toBe(false);
    expect(isAllowedEndpoint("https://user@fcm.googleapis.com/x")).toBe(false);
    expect(isAllowedEndpoint("https://fcm.googleapis.com:8443/x")).toBe(false);
    expect(isAllowedEndpoint("https://169.254.169.254/")).toBe(false);
    expect(isAllowedEndpoint("not a url")).toBe(false);
  });

  it("aes128gcm payload decrypts for the subscriber (RFC 8291 receiver side)", () => {
    const ua = createECDH("prime256v1");
    ua.generateKeys();
    const auth = randomBytes(16);
    const msg = Buffer.from(JSON.stringify({ title: "नमस्ते", href: "/songs/1" }));
    const body = encryptPayload({ p256dh: b64uEncode(ua.getPublicKey()), auth: b64uEncode(auth) }, msg);
    const salt = body.subarray(0, 16);
    expect(body.readUInt32BE(16)).toBe(4096);
    const idLen = body[20]!;
    const asPublic = body.subarray(21, 21 + idLen);
    const ct = body.subarray(21 + idLen);
    const shared = ua.computeSecret(asPublic);
    const ikm = Buffer.from(hkdfSync("sha256", shared, auth, Buffer.concat([Buffer.from("WebPush: info\0"), ua.getPublicKey(), asPublic]), 32));
    const cek = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
    const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
    const d = createDecipheriv("aes-128-gcm", cek, nonce);
    d.setAuthTag(ct.subarray(ct.length - 16));
    const plain = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
    expect(plain.subarray(0, plain.length - 1).equals(msg)).toBe(true);
    expect(plain[plain.length - 1]).toBe(2);
  });

  it("signs a verifiable ES256 VAPID JWT", () => {
    const cfg = { ...keys, subject: "mailto:a@b.co" };
    const jwt = vapidJwt(cfg, "https://fcm.googleapis.com", 1_700_000_000_000);
    const [h, p, s] = jwt.split(".") as [string, string, string];
    const claims = JSON.parse(b64uDecode(p).toString());
    expect(claims).toMatchObject({ aud: "https://fcm.googleapis.com", sub: "mailto:a@b.co" });
    expect(claims.exp).toBe(1_700_000_000 + 12 * 3600);
    const pub = b64uDecode(keys.publicKey);
    const k = createPublicKey({ key: { kty: "EC", crv: "P-256", x: b64uEncode(pub.subarray(1, 33)), y: b64uEncode(pub.subarray(33, 65)) }, format: "jwk" });
    expect(verify("sha256", Buffer.from(`${h}.${p}`), { key: k, dsaEncoding: "ieee-p1363" }, b64uDecode(s))).toBe(true);
  });
});

describe("service worker push handlers", () => {
  const sw = readFileSync(new URL("../../../public/sw.js", import.meta.url), "utf8");
  it("shows notifications and only opens same-origin paths", () => {
    expect(sw).toContain('addEventListener("push"');
    expect(sw).toContain('addEventListener("notificationclick"');
    expect(sw).toContain("safePath");
  });
});

