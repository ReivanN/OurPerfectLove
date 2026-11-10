/* Вся логика API. Хранилище передаётся снаружи, поэтому её можно тестировать без Netlify. */
import { createHash, timingSafeEqual, randomUUID } from "node:crypto";

const AUTHORS = ["him", "vika"];
const MAX_PHOTOS = 4;
const MAX_PHOTO_BYTES = 3 * 1024 * 1024;
const MAX_BODY_BYTES = 12 * 1024 * 1024;
const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_ITEMS = 1000;

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra },
  });
}
const fail = (status, error) => json({ error }, status);

function samePassword(given, expected) {
  const a = createHash("sha256").update(String(given ?? "")).digest();
  const b = createHash("sha256").update(String(expected)).digest();
  return timingSafeEqual(a, b);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function cleanStr(v, max) {
  if (typeof v !== "string") return "";
  return v.replace(/\r\n/g, "\n").trim().slice(0, max);
}
function validDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  return !isNaN(d) && d.toISOString().slice(0, 10) === s;
}

async function listJson(store, prefix) {
  const { blobs } = await store.list({ prefix });
  const items = await Promise.all(blobs.map((b) => store.get(b.key, { type: "json" }).catch(() => null)));
  return items.filter(Boolean);
}

export async function handle(req, store, password, opts = {}) {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, "");
  const m = req.method;
  const wrongDelay = opts.wrongDelayMs ?? 700;

  /* ---- чтение (открыто, как и остальные заметки на сайте) ---- */
  if (m === "GET" && path === "/api/data") {
    const [jar, notes] = await Promise.all([listJson(store, "jar/"), listJson(store, "note/")]);
    jar.sort((a, b) => (a.ts < b.ts ? 1 : -1));
    notes.sort((a, b) => (a.sort < b.sort ? 1 : -1));
    return json({ jar, notes, canWrite: Boolean(password) });
  }
  const ph = path.match(/^\/api\/photo\/([0-9a-f-]{36})$/);
  if (m === "GET" && ph) {
    const entry = await store.getWithMetadata("photo/" + ph[1], { type: "arrayBuffer" });
    if (!entry) return fail(404, "Фото не найдено");
    return new Response(entry.data, {
      headers: {
        "content-type": entry.metadata?.contentType || "image/jpeg",
        "cache-control": "public, max-age=31536000, immutable",
      },
    });
  }

  /* ---- всё остальное требует пароль ---- */
  if (!["POST", "DELETE"].includes(m) || !path.startsWith("/api/")) return fail(404, "Не найдено");
  if (!password) return fail(503, "Пароль ещё не задан на сайте (переменная SITE_PASSWORD).");
  if (!samePassword(req.headers.get("x-site-password"), password)) {
    await sleep(wrongDelay);
    return fail(401, "Неверный пароль");
  }

  if (m === "POST" && path === "/api/auth") return json({ ok: true });

  if (m === "POST" && path === "/api/jar") {
    let body;
    try { body = await req.json(); } catch { return fail(400, "Некорректный запрос"); }
    const text = cleanStr(body?.text, 500);
    const from = body?.from;
    if (!text) return fail(400, "Напишите текст записки");
    if (!AUTHORS.includes(from)) return fail(400, "Выберите, кто пишет");
    const { blobs } = await store.list({ prefix: "jar/" });
    if (blobs.length >= MAX_ITEMS) return fail(400, "В баночке больше нет места");
    const item = { id: randomUUID(), text, from, ts: new Date().toISOString() };
    await store.setJSON("jar/" + item.id, item);
    return json(item, 201);
  }

  if (m === "POST" && path === "/api/note") {
    const len = Number(req.headers.get("content-length") || 0);
    if (len > MAX_BODY_BYTES) return fail(413, "Слишком большие фото");
    let form;
    try { form = await req.formData(); } catch { return fail(400, "Некорректный запрос"); }
    const date = cleanStr(form.get("date"), 10);
    const author = form.get("author");
    const text = cleanStr(form.get("text"), 6000);
    const title = cleanStr(form.get("title"), 120);
    const mood = cleanStr(form.get("mood"), 12);
    if (!validDate(date)) return fail(400, "Укажите дату");
    if (!AUTHORS.includes(author)) return fail(400, "Выберите, кто пишет");
    if (!text) return fail(400, "Напишите текст заметки");
    const files = form.getAll("photos").filter((f) => f && typeof f === "object" && f.size > 0);
    if (files.length > MAX_PHOTOS) return fail(400, "Можно прикрепить не больше " + MAX_PHOTOS + " фото");
    for (const f of files) {
      if (!PHOTO_TYPES.includes(f.type)) return fail(400, "Подходят только фото JPG, PNG или WebP");
      if (f.size > MAX_PHOTO_BYTES) return fail(413, "Одно из фото слишком большое");
    }
    const { blobs } = await store.list({ prefix: "note/" });
    if (blobs.length >= MAX_ITEMS) return fail(400, "Слишком много заметок");
    const now = new Date();
    const photos = [];
    for (const f of files) {
      const pid = randomUUID();
      await store.set("photo/" + pid, await f.arrayBuffer(), { metadata: { contentType: f.type } });
      photos.push(pid);
    }
    const item = {
      id: randomUUID(), date, sort: date + "T" + now.toISOString().slice(11, 19),
      author, mood, title, text, photos, ts: now.toISOString(),
    };
    await store.setJSON("note/" + item.id, item);
    return json({ ...item }, 201);
  }

  const del = path.match(/^\/api\/(jar|note)\/([0-9a-f-]{36})$/);
  if (m === "DELETE" && del) {
    const [, kind, id] = del;
    if (kind === "note") {
      const item = await store.get("note/" + id, { type: "json" });
      if (!item) return fail(404, "Не найдено");
      for (const pid of item.photos || []) await store.delete("photo/" + pid);
    } else if (!(await store.get("jar/" + id, { type: "json" }))) {
      return fail(404, "Не найдено");
    }
    await store.delete(kind + "/" + id);
    return json({ ok: true });
  }

  return fail(404, "Не найдено");
}
