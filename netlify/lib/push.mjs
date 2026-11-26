/* Push-уведомления: ключи, подписки телефонов и рассылка. */
import webpush from "web-push";
import { createHash } from "node:crypto";

const KEYS = "vapid";
const SUB = "sub/";
export const KINDS = ["news", "milestones", "daily"];

/* Ключи создаются сами при первом обращении и хранятся в отдельном хранилище. */
export async function vapidKeys(store) {
  let keys = await store.get(KEYS, { type: "json" });
  if (!keys) {
    keys = webpush.generateVAPIDKeys();
    await store.setJSON(KEYS, keys, { onlyIfNew: true }).catch(() => {});
    keys = (await store.get(KEYS, { type: "json" })) || keys;
  }
  return keys;
}

const subKey = (endpoint) => SUB + createHash("sha256").update(endpoint).digest("hex");

export function validSub(s) {
  return s && typeof s.endpoint === "string" && /^https:\/\//.test(s.endpoint) && s.endpoint.length < 2000 &&
    s.keys && typeof s.keys.p256dh === "string" && typeof s.keys.auth === "string";
}

export async function saveSub(store, sub, who, kinds) {
  const rec = {
    sub: { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } },
    who, kinds: KINDS.filter((k) => kinds?.[k] !== false), ts: new Date().toISOString(),
  };
  await store.setJSON(subKey(sub.endpoint), rec);
  return rec;
}
export const getSub = (store, endpoint) => store.get(subKey(endpoint), { type: "json" });
export const deleteSub = (store, endpoint) => store.delete(subKey(endpoint));

/* Отправить уведомление всем подходящим подпискам. filter(rec) решает, кому. */
export async function sendPush(store, payload, filter = () => true) {
  const { blobs } = await store.list({ prefix: SUB });
  const recs = (await Promise.all(blobs.map((b) => store.get(b.key, { type: "json" }).catch(() => null)))).filter(Boolean);
  const targets = recs.filter(filter);
  if (!targets.length) return { sent: 0 };
  const keys = await vapidKeys(store);
  const opts = { vapidDetails: { subject: "https://ourperfectlove.netlify.app", publicKey: keys.publicKey, privateKey: keys.privateKey }, TTL: 60 * 60 * 24, timeout: 8000 };
  const body = JSON.stringify(payload);
  let sent = 0;
  await Promise.allSettled(targets.map(async (rec) => {
    try { await webpush.sendNotification(rec.sub, body, opts); sent++; }
    catch (e) {
      /* телефон отписался или подписка устарела */
      if (e && (e.statusCode === 404 || e.statusCode === 410)) await deleteSub(store, rec.sub.endpoint);
      else console.error("push failed", e?.statusCode, e?.body || e?.message);
    }
  }));
  return { sent };
}
