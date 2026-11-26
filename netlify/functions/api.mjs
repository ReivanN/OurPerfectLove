import { getStore } from "@netlify/blobs";
import { handle } from "../lib/handler.mjs";

/* Одна функция обслуживает все адреса вида /api/... */
export default async (req) => {
  const store = getStore({ name: "love", consistency: "strong" });
  const pushStore = getStore({ name: "push", consistency: "strong" });
  return handle(req, store, Netlify.env.get("SITE_PASSWORD"), { pushStore });
};

export const config = { path: "/api/*" };
