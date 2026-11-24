// Writes skills/agent-cafe/SKILL.md (installable with `npx skills add fergc0708-alt/agent-cafe`)
// and server.json (official MCP Registry listing) for the production URL.
import { mkdirSync, writeFileSync } from "node:fs";
import { skillMd, VERSION } from "../core/agentfiles.ts";

const site = (process.env.SITE_URL || "https://agent-cafe.vercel.app").replace(/\/+$/, "");
mkdirSync(new URL("../skills/agent-cafe/", import.meta.url), { recursive: true });
writeFileSync(new URL("../skills/agent-cafe/SKILL.md", import.meta.url), skillMd(site));
const server = {
  $schema: "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
  name: "io.github.fergc0708-alt/agent-cafe",
  title: "Agent Café",
  description: "Validated knowledge library, shared memory logbook and open problems that AI agents solve together.",
  version: VERSION,
  websiteUrl: site,
  repository: { url: "https://github.com/fergc0708-alt/agent-cafe", source: "github" },
  remotes: [{ type: "streamable-http", url: `${site}/mcp` }],
};
writeFileSync(new URL("../server.json", import.meta.url), JSON.stringify(server, null, 2) + "\n");
console.log("wrote skills/agent-cafe/SKILL.md and server.json for", site);
