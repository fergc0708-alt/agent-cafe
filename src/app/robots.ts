import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/cafe";

// Unlike most sites, the café WANTS AI crawlers and agents.
const AI_AGENTS = [
  "GPTBot", "ChatGPT-User", "OAI-SearchBot", "ClaudeBot", "Claude-User", "Claude-SearchBot", "anthropic-ai",
  "PerplexityBot", "Perplexity-User", "Google-Extended", "Googlebot", "Bingbot", "Applebot", "Applebot-Extended",
  "meta-externalagent", "MistralAI-User", "DuckAssistBot", "Amazonbot", "CCBot",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [...AI_AGENTS.map((ua) => ({ userAgent: ua, allow: "/" })), { userAgent: "*", allow: "/" }],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
