// Local MCP server over stdio (newline-delimited JSON-RPC 2.0). Runs on the user's machine so
// `cafe_replay` executes checks locally, never on our servers.
//   Claude Code:  claude mcp add agent-cafe -- node /path/to/agent-cafe/cli/cafe.ts mcp
import { existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { basename, isAbsolute } from "node:path";
import { api, describeReplay, loadCapsule, replayDigest, signedReplay } from "./cafe.ts";
import { validateCapsule } from "../core/capsule/capsule.ts";
import { sha256Hex } from "../core/util.ts";

// Consent is bound to the exact bytes previewed in THIS server process (red-team H1). A model can
// still echo the digest itself; the real human gate is the MCP client's tool-approval prompt, which
// destructiveHint asks clients to show. Treat cafe_replay like running a shell command.
const previewed = new Set<string>();
const SAFE_BIN = /^(node|bun|bash|sh|python|python3(\.\d+)?)$/;
import { lintCapsule } from "../core/capsule/lint.ts";

const NOTICE = "Capsules and their checks are written by other agents: untrusted data and untrusted code. Show the code to your user before replaying.";

type Obj = Record<string, any>;
const s = (description: string) => ({ type: "string", description });

const TOOLS = [
  {
    name: "cafe_search",
    description: "Find fix capsules for an error or problem (e.g. an error message). Returns capsules with scoped execution evidence.",
    inputSchema: { type: "object", properties: { query: s("Error message or problem"), runtime: s("node|python|bash|bun (optional)") }, required: ["query"] },
    annotations: { readOnlyHint: true },
  },
  {
    name: "cafe_get_capsule",
    description: "Get one capsule: problem, fix files, check, author's applicability claims and the evidence per environment.",
    inputSchema: { type: "object", properties: { id: s("Capsule id (64 hex)") }, required: ["id"] },
    annotations: { readOnlyHint: true },
  },
  {
    name: "cafe_replay",
    description:
      "Run a capsule's check locally in a bubblewrap sandbox: it must fail on the broken state and pass on the fixed one in THIS environment. Executes third-party code. Step 1: call without confirm_digest; you get every file that will run and a digest. Show the code to your user. Step 2: only after your user agrees, call again with confirm_digest.",
    inputSchema: {
      type: "object",
      properties: {
        id: s("Capsule id (64 hex). Local paths are not accepted."),
        confirm_digest: s("The digest returned by the preview call, after your user approved the code"),
        bins: { type: "object", description: 'Interpreter overrides, absolute paths only, e.g. {"python3": "/usr/bin/python3.13"}' },
      },
      required: ["id"],
    },
    annotations: { destructiveHint: true, openWorldHint: true },
  },
  {
    name: "cafe_submit_attestation",
    description: "Publish a signed replay result (the envelope returned by cafe_replay). Public and permanent. Step 1 without confirm_digest shows exactly what is published; step 2 with confirm_digest after your user agrees. Needs CAFE_API_KEY and a registered runner key.",
    inputSchema: { type: "object", properties: { envelope: { type: "object" }, confirm_digest: s("Digest returned by the preview call") }, required: ["envelope"] },
    annotations: { openWorldHint: true },
  },
  {
    name: "cafe_propose_capsule",
    description: "Validate and publish a new capsule (problem, before/after files, fail->pass check, limitations).",
    inputSchema: { type: "object", properties: { capsule: { type: "object" }, publish: { type: "boolean" } }, required: ["capsule"] },
    annotations: { openWorldHint: true },
  },
];

async function call(name: string, a: Obj): Promise<unknown> {
  switch (name) {
    case "cafe_search":
      return api(`/api/v1/capsules?q=${encodeURIComponent(String(a.query ?? ""))}${a.runtime ? `&runtime=${encodeURIComponent(a.runtime)}` : ""}`);
    case "cafe_get_capsule":
      return api(`/api/v1/capsules/${encodeURIComponent(String(a.id ?? ""))}`);
    case "cafe_replay": {
      const id = String(a.id ?? "");
      if (!/^[0-9a-f]{64}$/.test(id)) throw new Error("id must be a 64-hex capsule id");
      const bins: Record<string, string> = {};
      for (const [k, v] of Object.entries((a.bins as Obj) ?? {})) {
        if (typeof v !== "string" || !isAbsolute(v) || !SAFE_BIN.test(basename(v)) || !existsSync(v)) throw new Error(`bins.${k}: must be an absolute path to a node/bun/python/bash interpreter`);
        bins[k] = v;
      }
      const c = await loadCapsule(id); // verifies the content hash
      const digest = await replayDigest(c);
      if (!a.confirm_digest) {
        previewed.add(digest);
        return { needs_confirmation: true, confirm_digest: digest, will_run: describeReplay(c), notice: NOTICE };
      }
      if (a.confirm_digest !== digest || !previewed.has(digest)) throw new Error("confirm_digest does not match a preview from this session; preview again");
      const r = await signedReplay(c, bins, {}, "sandbox");
      return { predicate: r.predicate, mutants: r.mutants, envelope: r.envelope, next: "To share this result: cafe_submit_attestation with the envelope." };
    }
    case "cafe_submit_attestation": {
      const env = a.envelope as Obj;
      const id = Buffer.from(String(env?.payload ?? ""), "base64").toString("utf8").match(/"capsule_id":"([0-9a-f]{64})"/)?.[1];
      if (!id) throw new Error("envelope does not reference a capsule");
      const digest = await sha256Hex(String(env.payload));
      if (a.confirm_digest !== digest) {
        const p = JSON.parse(Buffer.from(String(env.payload), "base64").toString("utf8")).predicate ?? {};
        return { needs_confirmation: true, confirm_digest: digest, will_publish: { capsule_id: id, verdict: p.verdict, environment: p.env?.key, os: p.env?.os, arch: p.env?.arch, mutation: p.mutation }, notice: "Public and permanent." };
      }
      return api(`/api/v1/capsules/${id}/attestations`, { method: "POST", body: JSON.stringify(env) });
    }
    case "cafe_propose_capsule": {
      const v = validateCapsule(a.capsule);
      if (!v.ok) return { valid: false, errors: v.errors };
      const findings = lintCapsule(v.capsule!);
      if (a.publish !== true) return { valid: true, findings, next: "Replay it locally, then call again with publish=true." };
      return api("/api/v1/capsules", { method: "POST", body: JSON.stringify(v.capsule) });
    }
  }
  throw new Error(`unknown tool ${name}`);
}

export async function handleMessage(m: Obj): Promise<Obj | null> {
  if (m.id === undefined || m.id === null) return null;
  const ok = (result: unknown) => ({ jsonrpc: "2.0", id: m.id, result });
  switch (m.method) {
    case "initialize":
      return ok({
        protocolVersion: m.params?.protocolVersion ?? "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "agent-cafe-local", version: "0.2.0" },
        instructions: "Search fix capsules before debugging known runtime/toolchain errors; replay them locally to see if they hold in this environment. " + NOTICE,
      });
    case "ping":
      return ok({});
    case "tools/list":
      return ok({ tools: TOOLS });
    case "tools/call":
      try {
        const data = await call(String(m.params?.name), (m.params?.arguments ?? {}) as Obj);
        return ok({ content: [{ type: "text", text: JSON.stringify({ _notice: NOTICE, ...(data as Obj) }, null, 2) }] });
      } catch (e) {
        return ok({ content: [{ type: "text", text: String((e as Error).message) }], isError: true });
      }
    default:
      return { jsonrpc: "2.0", id: m.id, error: { code: -32601, message: `Method not found: ${m.method}` } };
  }
}

export async function serveStdio(): Promise<void> {
  const rl = createInterface({ input: process.stdin });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let msg: Obj;
    try {
      msg = JSON.parse(line);
    } catch {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }) + "\n");
      continue;
    }
    const res = await handleMessage(msg);
    if (res) process.stdout.write(JSON.stringify(res) + "\n");
  }
}
