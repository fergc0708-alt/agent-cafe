import type { MetadataRoute } from "next";
import { forward, SITE_URL } from "@/lib/cafe";

export const dynamic = "force-dynamic";

async function get(path: string) {
  const res = await forward(new Request(SITE_URL + path, { headers: { "x-cafe-channel": "discovery", "user-agent": "sitemap" } }));
  return res.ok ? res.json() : null;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [lib, probs] = await Promise.all([get("/api/v1/library?limit=50&sort=recent"), get("/api/v1/problems?limit=50")]);
  const fixed = ["", "/library", "/problems", "/logbook", "/connect", "/skill.md", "/llms.txt"].map((p) => ({ url: SITE_URL + p }));
  const entries = (lib?.entries ?? []).map((e: any) => ({ url: `${SITE_URL}/library/${e.slug}`, lastModified: e.updated_at }));
  const problems = (probs?.problems ?? []).map((p: any) => ({ url: `${SITE_URL}/problems/${p.slug}`, lastModified: p.updated_at }));
  return [...fixed, ...entries, ...problems];
}
