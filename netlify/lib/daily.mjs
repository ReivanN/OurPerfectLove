/* Ежедневные уведомления: вехи и «записка дня». */
import { sendPush } from "./push.mjs";

/* Начало отсчёта, как на сайте (местное время, Москва = UTC+3, без перехода на летнее). */
export const START_DATE = "2026-08-19T20:30:00";
export const TZ_OFFSET_H = 3;

const pl = (k, f) => { const a = Math.abs(k) % 100, b = a % 10; return a > 10 && a < 20 ? f[2] : b > 1 && b < 5 ? f[1] : b === 1 ? f[0] : f[2]; };
const MONTHW = ["месяц", "месяца", "месяцев"];
const YEARW = ["год", "года", "лет"];

/* Даты храним как «настенное» время в UTC-полях, так проще считать календарь. */
const wall = (iso) => new Date(iso + "Z");
const dayOf = (d) => d.toISOString().slice(0, 10);
export const todayWall = (now = new Date()) => dayOf(new Date(now.getTime() + TZ_OFFSET_H * 36e5));

function addMonths(start, k) { const d = new Date(start); d.setUTCMonth(d.getUTCMonth() + k); return d; }

/* Все вехи (как на сайте) плюс каждый месяц и каждая годовщина. */
export function milestonesOn(day, startIso = START_DATE) {
  const s = wall(startIso);
  const addD = (n) => new Date(s.getTime() + n * 864e5);
  const list = [
    { t: "1 неделя", i: "🌱", at: addD(7) },
    { t: "50 дней", i: "⭐", at: addD(50) },
    { t: "1000 часов", i: "⏳", at: new Date(s.getTime() + 1000 * 36e5) },
    { t: "100 дней", i: "💯", at: addD(100) },
    { t: "200 дней", i: "🍀", at: addD(200) },
    { t: "500 дней", i: "🏆", at: addD(500) },
    { t: "1000 дней", i: "👑", at: addD(1000) },
  ];
  const ICONS = { 1: "🌷", 2: "🎀", 3: "💐", 6: "🌸" };
  for (let k = 1; k <= 12 * 50; k++) {
    if (k % 12 === 0) { const y = k / 12; list.push({ t: y === 1 ? "1 год" : `${y} ${pl(y, YEARW)}`, i: y === 1 ? "🎂" : "🥂", at: addMonths(s, k), year: true }); }
    else list.push({ t: `${k} ${pl(k, MONTHW)}`, i: ICONS[k] || "💞", at: addMonths(s, k) });
  }
  return list.filter((m) => dayOf(m.at) === day);
}

export function milestoneMessage(found) {
  if (!found.length) return null;
  const main = found.find((m) => m.year) || found[0];
  const names = found.map((m) => m.t).join(" и ");
  return {
    title: `${main.i} Сегодня ${names} вместе!`,
    body: main.year ? "С годовщиной, любимые! Загляните в наш уголок ❤️" : "Маленький праздник: загляните в наш уголок и посмотрите на вехи ❤️",
    url: "/#clock", tag: "milestone-" + dayOf(main.at),
  };
}

const FROM = { him: "от Леши", vika: "от Вики" };
export function dailyMessage(item, day) {
  return {
    title: "💌 Записка дня" + (FROM[item.from] ? " " + FROM[item.from] : ""),
    body: "«" + (item.text.length > 160 ? item.text.slice(0, 159) + "…" : item.text) + "»",
    url: "/#jar", tag: "daily-" + day,
  };
}

export async function runDaily({ pushStore, loadJar, now = new Date() }) {
  const day = todayWall(now);
  const out = { day, milestone: 0, daily: 0 };
  const ms = milestoneMessage(milestonesOn(day));
  if (ms) out.milestone = (await sendPush(pushStore, ms, (r) => r.kinds.includes("milestones"))).sent;

  const jar = (await loadJar()).filter((x) => x && typeof x.text === "string" && x.text.trim());
  if (jar.length) {
    const last = await pushStore.get("daily-last", { type: "json" }).catch(() => null);
    let pool = jar.filter((x) => x.text !== last?.text);
    if (!pool.length) pool = jar;
    const item = pool[Math.floor(Math.random() * pool.length)];
    out.daily = (await sendPush(pushStore, dailyMessage(item, day), (r) => r.kinds.includes("daily"))).sent;
    await pushStore.setJSON("daily-last", { text: item.text, day });
  }
  return out;
}
