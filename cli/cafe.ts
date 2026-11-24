#!/usr/bin/env node
// Agent Café CLI — know which runtime breaks hit YOUR code, with executed evidence.
// Usage: node cli/cafe.ts <command> [...]
//   doctor [dir] [--target node@24] [--python /path] [--node /path] [--json|--markdown] [--fail-on now|upgrade|never]
//                                       scan the project + environment for known breaks (now and on upgrade)
//   diagnose "<error text>" [--target python@3.13]   (or pipe the error into: cafe diagnose -)
//                                       match an error to known breaks for THIS environment
//   show <name|id>                      the fix (diff), the check, and where it was executed
//   replay <name|id|file> [--yes] [--sign] [--bin node=/path] [--isolation sandbox|net-only|none]
//                                       reproduce a capsule here, in a bubblewrap sandbox (asks first)
//   capture --check <test file> [--files a.py,b.py] [--title ..] [--symptom ..]
//                                       turn your fix into a private capsule (git HEAD = before), proven by replay
//   env [--json]                        this environment's fingerprint (stays local)
//   search <words...>                   search the catalog
//   mcp                                 local MCP server over stdio (Claude Code, Codex, Cursor...)
//   lint | keygen | register-runner | push | submit | get     registry and authoring commands
// Env: CAFE_URL (default https://agent-cafe.vercel.app), CAFE_API_KEY, CAFE_HOME (default ~/.agent-cafe)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { capsuleId, validateCapsule, type Capsule, type FileMap } from "../core/capsule/capsule.ts";
import { lintCapsule } from "../core/capsule/lint.ts";
import { buildStatement, generateRunnerKey, signRegistration, signStatement, type Envelope } from "../core/capsule/attestation.ts";
import { replay, runtimeVersion, type Isolation } from "./runner.ts";

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
  else if (/^[0-9a-f]{64}$/.test(ref)) {
    const { loadIndex } = await import("./doctor.ts");
    raw = (await loadIndex(resolve("."))).byId.get(ref)?.capsule ?? (await api(`/api/v1/capsules/${ref}`)).capsule;
  } else if (/^[a-z0-9][a-z0-9-]{1,80}$/.test(ref)) {
    const { loadIndex } = await import("./doctor.ts");
    raw = (await loadIndex(resolve("."))).bySlug.get(ref)?.capsule;
    if (!raw) throw new Error(`No capsule named "${ref}". Try: cafe search <words>`);
  } else throw new Error(`not a file, capsule name or id: ${ref}`);
  const v = validateCapsule(raw);
  if (!v.ok) throw new Error("invalid capsule:\n- " + v.errors.join("\n- "));
  // Content addressing: what the registry served must be exactly what was asked for (red-team H1).
  if (/^[0-9a-f]{64}$/.test(ref) && (await capsuleId(v.capsule!)) !== ref) throw new Error("the registry returned a capsule whose hash does not match the requested id");
  return v.capsule!;
}

const VALUE_FLAGS = new Set(["target", "fail-on", "check", "files", "title", "symptom", "name", "python", "node"]);

function flags(argv: string[]) {
  const pos: string[] = [];
  const bins: Record<string, string> = {};
  const conditions: Record<string, string> = {};
  const f = new Set<string>();
  const values: Record<string, string[]> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const name = a.startsWith("--") ? a.slice(2).split("=")[0] : "";
    if (VALUE_FLAGS.has(name)) {
      const v = a.includes("=") ? a.slice(a.indexOf("=") + 1) : argv[++i] ?? "";
      (values[name] ??= []).push(...(name === "target" ? v.split(",") : [v]));
      continue;
    }
    if (a === "--isolation") f.add("isolation=" + (argv[++i] ?? ""));
    else if (a === "--bin" || a === "--set") {
      const [k, ...rest] = (argv[++i] ?? "").split("=");
      (a === "--bin" ? bins : conditions)[k] = rest.join("=");
    } else if (a.startsWith("--")) f.add(a.slice(2));
    else pos.push(a);
  }
  // --python/--node <path>: evaluate the interpreter that really runs the code (e.g. a deploy venv)
  if (values.python?.[0]) bins.python3 = values.python[0];
  if (values.node?.[0]) bins.node = values.node[0];
  return { pos, bins, conditions, f, values };
}

/** What a replay will execute: EVERY file that can run (before, after, check), plus a digest the
 * consent is bound to. A capsule's fix files execute too, so showing only the check is not enough. */
export function describeReplay(c: Capsule, isolation: Isolation = "sandbox"): string {
  const iso =
    isolation === "sandbox" ? "bubblewrap sandbox: no network, read-only filesystem, home hidden" : isolation === "net-only" ? "NO SANDBOX: network cut only, the code can read and write your files" : "NO ISOLATION AT ALL";
  const section = (name: string, files: FileMap) => [`== ${name} ==`, ...Object.entries(files).map(([p, s]) => `--- ${p}\n${s}`)];
  return [
    `Capsule: ${c.title}`,
    `Runs: ${c.check.run.join(" ")} on the BEFORE files, the AFTER files and up to 8 mutants (timeout ${c.check.timeout_ms} ms each)`,
    `Isolation: ${iso}`,
    ...section("before (executes)", c.before.files),
    ...section("after (executes)", c.after.files),
    ...section("check (executes)", c.check.files),
  ].join("\n");
}

/** Digest a user/agent must echo back to consent to exactly this code. */
export function replayDigest(c: Capsule): Promise<string> {
  return capsuleId(c);
}

export async function signedReplay(c: Capsule, bins: Record<string, string>, conditions: Record<string, string>, isolation: Isolation) {
  const key = await ensureKey();
  const res = await replay(c, { bins, conditions, isolation, keyid: key.keyid });
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

function optValue(f: Set<string>, name: string): string | undefined {
  return [...f].find((x) => x.startsWith(name + "="))?.slice(name.length + 1);
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "signal") {
    const { main: signal } = await import("../signal/cli.ts");
    process.exitCode = await signal(rest);
    return;
  }
  const { pos, bins, conditions, f, values } = flags(rest);
  switch (cmd) {
    case "doctor": {
      const { doctor } = await import("./doctor.ts");
      const { renderDoctor, markdownDoctor } = await import("./render.ts");
      const r = await doctor(resolve(pos[0] ?? "."), values.target ?? [], bins, true);
      if (f.has("json")) console.log(JSON.stringify(r, null, 2));
      else if (f.has("markdown")) console.log(markdownDoctor(r));
      else console.log(renderDoctor(r, f.has("verbose")));
      const failOn = values["fail-on"]?.[0] ?? "never";
      if (!["now", "upgrade", "never"].includes(failOn)) throw new Error(`--fail-on must be now, upgrade or never (got "${failOn}")`);
      const now = r.findings.some((x) => x.verdicts.some((v) => !v.env.label.startsWith("upgrade") && v.status.startsWith("affected")));
      const any = r.findings.some((x) => x.verdicts.some((v) => v.status.startsWith("affected")));
      // Fail closed: code that could not be evaluated is never a pass.
      if (failOn !== "never" && r.not_evaluated.length) process.exitCode = 1;
      if ((failOn === "now" && now) || (failOn === "upgrade" && any)) process.exitCode = 1;
      return;
    }
    case "diagnose": {
      const { diagnose } = await import("./doctor.ts");
      const { renderDiagnose } = await import("./render.ts");
      let text = pos.join(" ");
      if (!text || text === "-") text = readFileSync(0, "utf8");
      if (!text.trim()) throw new Error('Give the error text: cafe diagnose "ModuleNotFoundError: ..." (or pipe it in with -)');
      const r = await diagnose(resolve("."), text, values.target ?? [], bins, true);
      console.log(f.has("json") ? JSON.stringify(r, null, 2) : renderDiagnose(r));
      return;
    }
    case "show": {
      const { loadIndex, environments } = await import("./doctor.ts");
      const { fingerprint } = await import("./fingerprint.ts");
      const { evaluate } = await import("../core/doctor/match.ts");
      const { renderShow } = await import("./render.ts");
      const index = await loadIndex(resolve("."));
      const e = index.bySlug.get(pos[0] ?? "") ?? index.entries.find((x) => x.id.startsWith(pos[0] ?? "--"));
      if (!e) throw new Error(`No capsule named "${pos[0] ?? ""}". Try: cafe search <words>`);
      const fp = await fingerprint(resolve("."));
      const verdicts = environments(fp, index, values.target ?? [], false).filter((x) => x.runtime === e.capsule.runtime).map((x) => evaluate(e, x));
      console.log(f.has("json") ? JSON.stringify({ ...e, verdicts }, null, 2) : renderShow(e, verdicts));
      return;
    }
    case "capture": {
      const { buildCandidate, capture } = await import("./capture.ts");
      const check = values.check?.[0];
      if (!check) throw new Error("Usage: cafe capture --check <test file> [--files a.py,b.py] [--title ...] [--symptom ...]");
      const o = { project: resolve("."), check, files: values.files?.[0]?.split(",").filter(Boolean), title: values.title?.[0], symptom: values.symptom?.[0], name: values.name?.[0], bins };
      const cand = buildCandidate(o);
      if (!cand.capsule) throw new Error("Cannot capture:\n- " + cand.problems.join("\n- "));
      if (!f.has("yes")) {
        console.error(describeReplay(cand.capsule));
        if (!process.stdin.isTTY) throw new Error("Refusing to run code without --yes (non-interactive).");
        const rl = createInterface({ input: process.stdin, output: process.stderr });
        const ans = await rl.question("\nReplay this in the sandbox to validate the capsule? [y/N] ");
        rl.close();
        if (!/^y(es)?$/i.test(ans.trim())) return;
      }
      const r = await capture(o, cand.capsule);
      if (r.saved) console.log(`Saved private capsule: ${r.saved}\nVerified here: the check fails on HEAD, passes with your change, and caught ${r.mutation.killed}/${r.mutation.total} mutants.${r.lint.length ? `\nWarnings: ${r.lint.join(", ")}` : ""}\nIt now shows up in cafe doctor/diagnose for this project. Nothing was uploaded.`);
      else {
        console.log(`Not saved (verdict ${r.verdict}):\n- ${r.reasons.join("\n- ")}`);
        process.exitCode = 1;
      }
      return;
    }
    case "env": {
      const { fingerprint } = await import("./fingerprint.ts");
      const { envLine } = await import("./render.ts");
      const fp = await fingerprint(resolve(pos[0] ?? "."));
      if (f.has("json")) console.log(JSON.stringify(fp, null, 2));
      else console.log(`${envLine(fp)}\nproject: ${fp.project.kinds.join(", ") || "unknown"}${Object.keys(fp.project.declared).length ? ` · declared ${Object.entries(fp.project.declared).map(([k, v]) => `${k} ${v}`).join(", ")}` : ""}${fp.project.lockfiles.length ? ` · ${fp.project.lockfiles.join(", ")}` : ""}\nfingerprint ${fp.digest}${fp.missing.length ? `\nnot determined: ${fp.missing.join("; ")}` : ""}`);
      void bins;
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
      const isoFlag = [...f].find((x) => x.startsWith("isolation="))?.slice(10);
      const isolation: Isolation = f.has("no-isolate") ? "none" : isoFlag === "none" || isoFlag === "net-only" || isoFlag === "sandbox" ? isoFlag : "sandbox";
      if (!f.has("yes")) {
        console.error(describeReplay(c, isolation));
        if (!process.stdin.isTTY) throw new Error("Refusing to run untrusted code without --yes (non-interactive).");
        const rl = createInterface({ input: process.stdin, output: process.stderr });
        const ans = await rl.question("\nRun this code on this machine? [y/N] ");
        rl.close();
        if (!/^y(es)?$/i.test(ans.trim())) return;
      }
      const out = f.has("sign") ? await signedReplay(c, bins, conditions, isolation) : await replay(c, { bins, conditions, isolation });
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
      const handle = (await api("/api/v1/agents/me")).you?.handle;
      if (!handle) throw new Error("Could not read your handle: set CAFE_API_KEY.");
      const proof = await signRegistration(handle, k.publicRaw, k.privateJwk);
      // The label is public: default to a neutral name instead of the hostname.
      console.log(JSON.stringify(await api("/api/v1/runners", { method: "POST", body: JSON.stringify({ public_key: k.publicRaw, proof, label: pos[0] ?? "runner" }) }), null, 2));
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
      if (f.has("registry")) {
        console.log(JSON.stringify(await api(`/api/v1/capsules?q=${encodeURIComponent(pos.join(" "))}`), null, 2));
        return;
      }
      const { loadIndex } = await import("./doctor.ts");
      const index = await loadIndex(resolve("."));
      const words = pos.join(" ").toLowerCase().split(/\s+/).filter(Boolean);
      const scored = index.entries
        .map((e) => ({ e, s: words.filter((w) => `${e.slug} ${e.capsule.title} ${e.capsule.problem.symptom} ${e.capsule.problem.tags.join(" ")}`.toLowerCase().includes(w)).length }))
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, 10);
      if (!scored.length) console.log("No capsule matches. For an error message, try: cafe diagnose \"<error>\"");
      for (const { e } of scored) console.log(`${e.slug.padEnd(30)} ${e.capsule.title}`);
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
