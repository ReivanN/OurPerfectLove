import { getStore } from "@netlify/blobs";
import vm from "node:vm";
import { runDaily } from "../lib/daily.mjs";

/* Записки из jar.js (лежат на самом сайте) и добавленные через сайт. */
async function loadJar() {
  const items = [];
  const base = Netlify.env.get("URL");
  if (base) {
    try {
      const res = await fetch(new URL("/jar.js", base));
      if (res.ok) {
        const sandbox = { window: {} };
        vm.runInNewContext(await res.text(), sandbox, { timeout: 200 });
        if (Array.isArray(sandbox.window.JAR)) items.push(...sandbox.window.JAR);
      }
    } catch (e) { console.error("jar.js не прочитался", e); }
  }
  const love = getStore({ name: "love", consistency: "strong" });
  const { blobs } = await love.list({ prefix: "jar/" });
  const dyn = await Promise.all(blobs.map((b) => love.get(b.key, { type: "json" }).catch(() => null)));
  return items.concat(dyn.filter(Boolean));
}

/* Каждый день в 9:00 по Москве (6:00 UTC). */
export default async () => {
  const pushStore = getStore({ name: "push", consistency: "strong" });
  const out = await runDaily({ pushStore, loadJar });
  console.log("daily push", JSON.stringify(out));
};

export const config = { schedule: "0 6 * * *" };
