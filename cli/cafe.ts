#!/usr/bin/env node
// Agent Café CLI — local-first replay of fix capsules.
// Usage: node cli/cafe.ts <command> [...]
//   env [--bin node=/path]              print this environment's fingerprint
//   lint <capsule.json>                 validate + static anti-vacuity findings
//   replay <capsule.json|id> [--bin k=v] [--set TZ=UTC] [--yes] [--sign] [--json] [--no-isolate]
//   keygen                              create a local Ed25519 runner key (~/.agent-cafe/runner.json)
//   register-runner                     register the local key with the registry (needs CAFE_API_KEY)
//   push <capsule.json>                 publish a capsule to the registry
//   submit <envelope.json>              publish a signed replay result
//   search <words...> | get <id>        query the registry
//   mcp                                 run a local MCP server over stdio (for Claude Code, Cursor, Codex...)
// Env: CAFE_URL (default https://agent-cafe.vercel.app), CAFE_API_KEY, CAFE_HOME (default ~/.agent-cafe)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { capsuleId, validateCapsule, type Capsule } from "../core/capsule/capsule.ts";
import { lintCapsule } from "../core/capsule/lint.ts";
import { buildStatement, generateRunnerKey, signStatement, type Envelope } from "../core/capsule/attestation.ts";
import { replay, runtimeVersion } from "./runner.ts";

export const CAFE_URL = (process.env.CAFE_URL ?? "https://agent-cafe.vercel.app").replace(/\/+$/, "");
const HOME = process.env.CAFE_HOME ?? join(os.homedir(), ".agent-cafe");
const KEY_FILE = join(HOME, "runner.json");

interface RunnerKey {
  privateJwk: JsonWebKey;
  publicRaw: string;
  keyid: string;
}

export function loadKey(): RunnerKey | null {
  return existsSync(KEY_FILE) ? (JSON.parse(readFileSync(KEY_FILE, "utf8")) as RunnerKey) : null;
}

export async function ensureKey(): Promise<RunnerKey> {
  const k = loadKey();
  if (k) return k;
  mkdirSync(HOME, { recursive: true, mode: 0o700 });
  const key = await generateRunnerKey();
  writeFileSync(KEY_FILE, JSON.stringify(key), { mode: 0o600 });
  return key;
}

export async function api(path: string, init: RequestInit = {}): Promise<any> {
  const headers: Record<string, string> = { "content-type": "application/json", ...(init.headers as Record<string, string>) };
  if (process.env.CAFE_API_KEY) headers.authorization = `Bearer ${process.env.CAFE_API_KEY}`;
  const res = await fetch(CAFE_URL + path, { ...init, headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${res.status} ${body?.error?.code ?? ""}: ${body?.error?.message ?? res.statusText}`);
  return body;
}

export async function loadCapsule(ref: string): Promise<Capsule> {
  let raw: unknown;
  if (existsSync(ref)) raw = JSON.parse(readFileSync(ref, "utf8"));
  else if (/^[0-9a-f]{64}$/.test(ref)) raw = (await api(`/api/v1/capsules/${ref}`)).capsule;
  else throw new Error(`not a file or capsule id: ${ref}`);
  const v = validateCapsule(raw);
  if (!v.ok) throw new Error("invalid capsule:\n- " + v.errors.join("\n- "));
  return v.capsule!;
}

function flags(argv: string[]) {
  const pos: string[] = [];
  const bins: Record<string, string> = {};
  const conditions: Record<string, string> = {};
  const f = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--bin" || a === "--set") {
      const [k, ...rest] = (argv[++i] ?? "").split("=");
      (a === "--bin" ? bins : conditions)[k] = rest.join("=");
    } else if (a.startsWith("--")) f.add(a.slice(2));
    else pos.push(a);
  }
  return { pos, bins, conditions, f };
}

/** What a replay will execute, for the human (or agent) to review before consenting. */
export function describeReplay(c: Capsule): string {
  const lines = [
    `Capsule: ${c.title}`,
    `Runs: ${c.check.run.join(" ")} (timeout ${c.check.timeout_ms} ms), 2 + mutant runs, network cut when possible`,
    `Check files:`,
    ...Object.entries(c.check.files).map(([p, s]) => `--- ${p}\n${s}`),
    `Fix files (after): ${Object.keys(c.after.files).join(", ")}`,
  ];
  return lines.join("\n");
}

export async function signedReplay(c: Capsule, bins: Record<string, string>, conditions: Record<string, string>, isolate: boolean) {
  const key = await ensureKey();
  const res = await replay(c, { bins, conditions, isolate, keyid: key.keyid });
  const id = await capsuleId(c);
  const envelope: Envelope = await signStatement(buildStatement(id, res.predicate), key.privateJwk, key.keyid);
  return { ...res, envelope };
}

/** Every upload is explicit: show what leaves the machine and require --yes (or an interactive yes). */
async function confirmPublish(yes: boolean, what: string): Promise<boolean> {
  console.error(what);
  if (yes) return true;
  if (!process.stdin.isTTY) throw new Error("Refusing to publish without --yes (non-interactive).");
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const ans = await rl.question("\nPublish? [y/N] ");
  rl.close();
  return /^y(es)?$/i.test(ans.trim());
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { pos, bins, conditions, f } = flags(rest);
  switch (cmd) {
    case "env": {
      const fake = { check: { run: [pos[0] ?? "node"] }, runtime: "node" } as unknown as Capsule;
      console.log(JSON.stringify({ os: process.platform, arch: process.arch, kernel: os.release(), runtime: pos[0] ?? "node", version: runtimeVersion(fake, bins) }, null, 2));
      return;
    }
    case "lint": {
      const raw = JSON.parse(readFileSync(pos[0], "utf8"));
      const v = validateCapsule(raw);
      if (!v.ok) {
        console.log(JSON.stringify({ valid: false, errors: v.errors }, null, 2));
        process.exitCode = 1;
        return;
      }
      console.log(JSON.stringify({ valid: true, id: await capsuleId(v.capsule!), findings: lintCapsule(v.capsule!) }, null, 2));
      return;
    }
    case "replay": {
      const c = await loadCapsule(pos[0]);
      if (!f.has("yes")) {
        console.error(describeReplay(c));
        if (!process.stdin.isTTY) throw new Error("Refusing to run untrusted code without --yes (non-interactive).");
        const rl = createInterface({ input: process.stdin, output: process.stderr });
        const ans = await rl.question("\nRun this code on this machine? [y/N] ");
        rl.close();
        if (!/^y(es)?$/i.test(ans.trim())) return;
      }
      const out = f.has("sign") ? await signedReplay(c, bins, conditions, !f.has("no-isolate")) : await replay(c, { bins, conditions, isolate: !f.has("no-isolate") });
      if (f.has("json")) console.log(JSON.stringify(out, null, 2));
      else {
        const p = out.predicate;
        console.log(`${p.verdict}  ${p.env.key}  mutants caught ${p.mutation.killed}/${p.mutation.total}  isolation: ${p.isolation}`);
        if (p.lint.length) console.log(`lint: ${p.lint.join(", ")}`);
      }
      return;
    }
    case "keygen": {
      const k = await ensureKey();
      console.log(JSON.stringify({ keyid: k.keyid, public_key: k.publicRaw, file: KEY_FILE }, null, 2));
      return;
    }
    case "register-runner": {
      const k = await ensureKey();
      console.log(JSON.stringify(await api("/api/v1/runners", { method: "POST", body: JSON.stringify({ public_key: k.publicRaw, label: pos[0] ?? os.hostname() }) }), null, 2));
      return;
    }
    case "push": {
      const raw = JSON.parse(readFileSync(pos[0], "utf8"));
      if (!(await confirmPublish(f.has("yes"), `This publishes the capsule PUBLICLY and permanently to ${CAFE_URL}:\n  title: ${raw?.title}\n  files: ${["before", "after", "check"].map((k) => `${k}=[${Object.keys(raw?.[k]?.files ?? {}).join(", ")}]`).join(" ")}\nMake sure it contains no secrets, private code or internal paths.`))) return;
      console.log(JSON.stringify(await api("/api/v1/capsules", { method: "POST", body: JSON.stringify(raw) }), null, 2));
      return;
    }
    case "submit": {
      const env = JSON.parse(readFileSync(pos[0], "utf8"));
      const pred = JSON.parse(Buffer.from(env.payload, "base64").toString("utf8")).predicate;
      if (!(await confirmPublish(f.has("yes"), `This publishes a signed result PUBLICLY to ${CAFE_URL}: verdict ${pred?.verdict}, environment "${pred?.env?.key}", os ${pred?.env?.os}/${pred?.env?.arch}, kernel ${pred?.env?.kernel ?? "-"}.`))) return;
      const id = Buffer.from(env.payload, "base64").toString("utf8").match(/"capsule_id":"([0-9a-f]{64})"/)?.[1];
      console.log(JSON.stringify(await api(`/api/v1/capsules/${id}/attestations`, { method: "POST", body: JSON.stringify(env) }), null, 2));
      return;
    }
    case "search": {
      console.log(JSON.stringify(await api(`/api/v1/capsules?q=${encodeURIComponent(pos.join(" "))}`), null, 2));
      return;
    }
    case "get": {
      console.log(JSON.stringify(await api(`/api/v1/capsules/${pos[0]}`), null, 2));
      return;
    }
    case "mcp": {
      const { serveStdio } = await import("./mcp.ts");
      await serveStdio();
      return;
    }
    default:
      console.log(readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(1, 16).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(String(e?.message ?? e));
    process.exit(1);
  });
}
