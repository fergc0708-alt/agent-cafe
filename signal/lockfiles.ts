// Dependency deltas between two states of a repository, read from lockfiles/manifests. Pure functions over file
// text, so the same code runs on the base and head versions of each file (from `git show <ref>:<path>`).
import type { Change, Ecosystem } from "./protocol.ts";
import { normalizePackage, normalizeVersion } from "./protocol.ts";

export type Versions = Map<string, string>; // package -> version

/** npm package-lock.json (v1, v2, v3). Nested copies (a/node_modules/b) count once per name, first wins. */
export function npmLock(text: string): Versions {
  const out: Versions = new Map();
  let j: any;
  try {
    j = JSON.parse(text);
  } catch {
    return out;
  }
  if (j.packages && typeof j.packages === "object") {
    // The hoisted copy (node_modules/<name>) is the one the project resolves; nested copies only fill gaps.
    const entries = Object.entries<any>(j.packages).filter(([path, info]) => path.includes("node_modules/") && info?.version && !info.link);
    const nameOf = (path: string) => path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length);
    for (const nested of [false, true]) {
      for (const [path, info] of entries) {
        const isNested = path.indexOf("node_modules/") !== path.lastIndexOf("node_modules/") || !path.startsWith("node_modules/");
        if (isNested !== nested) continue;
        const n = normalizePackage("npm", nameOf(path));
        if (!out.has(n)) out.set(n, normalizeVersion(String(info.version)));
      }
    }
  } else if (j.dependencies) {
    const walk = (deps: any) => {
      for (const [name, info] of Object.entries<any>(deps ?? {})) {
        const n = normalizePackage("npm", name);
        if (info?.version && !out.has(n)) out.set(n, normalizeVersion(String(info.version)));
        walk(info?.dependencies);
      }
    };
    walk(j.dependencies);
  }
  return out;
}

/** pnpm-lock.yaml (v6-v9): keys like "/name@1.2.3" or "name@1.2.3" under packages:. Line-based, no YAML lib. */
export function pnpmLock(text: string): Versions {
  const out: Versions = new Map();
  // Direct dependencies first: importers.<dir>.(dev)dependencies.<name>.version (strip "(peer)" suffixes).
  let inImp = false, cur: string | null = null;
  for (const line of text.split(/\r?\n/)) {
    if (/^importers:\s*$/.test(line)) { inImp = true; continue; }
    if (/^\S/.test(line)) inImp = false;
    if (!inImp) continue;
    const n = line.match(/^ {6}['"]?((?:@[^/'"\s]+\/)?[^'":\s]+)['"]?:\s*$/);
    if (n) { cur = n[1]; continue; }
    const v = line.match(/^ {8}version:\s*['"]?([^('"\s]+)/);
    if (v && cur && !v[1].startsWith("link:")) { const k = normalizePackage("npm", cur); if (!out.has(k)) out.set(k, normalizeVersion(v[1])); cur = null; }
  }
  let inPkgs = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^packages:\s*$/.test(line)) { inPkgs = true; continue; }
    if (/^\S/.test(line)) inPkgs = false;
    if (!inPkgs) continue;
    const m = line.match(/^ {2}['"]?\/?((?:@[^/@\s'"]+\/)?[^@\s'"/]+)@([^('":\s]+)/);
    if (m) {
      const n = normalizePackage("npm", m[1]);
      if (!out.has(n)) out.set(n, normalizeVersion(m[2]));
    }
  }
  return out;
}

/** yarn.lock (v1 and berry): `"name@range", name@range:` headers followed by `version "x"` / `version: x`. */
export function yarnLock(text: string): Versions {
  const out: Versions = new Map();
  let names: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (/^\S.*:\s*$/.test(line) && !line.startsWith("#") && !line.startsWith("__metadata")) {
      names = line.replace(/:\s*$/, "").split(/,\s*/).map((s) => s.replace(/^"|"$/g, ""))
        .filter((s) => !/@(patch|workspace|link|portal|file):/.test(s))
        .map((s) => { const at = s.indexOf("@", 1); return at > 0 ? s.slice(0, at) : s; }); // "alias@npm:real@^1" -> alias
      continue;
    }
    const v = line.match(/^\s+version:?\s+"?([^"\s]+)"?/);
    if (v && names.length) {
      for (const n of names) if (n && !out.has(normalizePackage("npm", n))) out.set(normalizePackage("npm", n), normalizeVersion(v[1]));
      names = [];
    }
  }
  return out;
}

/** requirements*.txt / constraints: only exact pins (==, ===) are versions; ranges are not resolved states. */
export function requirements(text: string): Versions {
  const out: Versions = new Map();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.slice(0, 1000).replace(/[ \t]#.*$/, "").trim();
    const m = line.match(/^([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[[^\]]*\])?\s*===?\s*([A-Za-z0-9.+!_-]+)/);
    if (m) out.set(normalizePackage("pypi", m[1]), normalizeVersion(m[2]));
  }
  return out;
}

/** uv.lock / poetry.lock / pdm.lock: [[package]] tables with name = "..." and version = "...". */
export function tomlLock(text: string): Versions {
  const out: Versions = new Map();
  let name: string | null = null;
  for (const line of text.split(/\r?\n/)) {
    if (/^\[\[package\]\]/.test(line)) { name = null; continue; }
    const n = line.match(/^name\s*=\s*"([^"]+)"/);
    if (n) { name = n[1]; continue; }
    const v = line.match(/^version\s*=\s*"([^"]+)"/);
    if (v && name) { const k = normalizePackage("pypi", name); if (!out.has(k)) out.set(k, normalizeVersion(v[1])); name = null; }
  }
  return out;
}

/** Direct dependencies declared in package.json / pyproject.toml (names only). */
export function declared(file: string, text: string): Set<string> {
  const out = new Set<string>();
  if (file.endsWith("package.json")) {
    try {
      const j = JSON.parse(text);
      for (const k of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) for (const n of Object.keys(j[k] ?? {})) out.add(normalizePackage("npm", n));
    } catch { /* not JSON */ }
  } else if (file.endsWith("pyproject.toml") || /requirements.*\.(txt|in)$/.test(file)) {
    for (const m of text.matchAll(/^[ \t]*["']?([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[[^\]]*\])?[ \t]*(?:[=<>!~]=?|["',]|$)/gm)) out.add(normalizePackage("pypi", m[1]));
  }
  return out;
}

export const LOCKFILES: { match: RegExp; ecosystem: Ecosystem; parse: (t: string) => Versions }[] = [
  { match: /(^|\/)package-lock\.json$|(^|\/)npm-shrinkwrap\.json$/, ecosystem: "npm", parse: npmLock },
  { match: /(^|\/)pnpm-lock\.yaml$/, ecosystem: "npm", parse: pnpmLock },
  { match: /(^|\/)yarn\.lock$/, ecosystem: "npm", parse: yarnLock },
  { match: /(^|\/)(uv|poetry|pdm)\.lock$/, ecosystem: "pypi", parse: tomlLock },
  { match: /(^|\/)(requirements|constraints)[^/]*\.txt$/, ecosystem: "pypi", parse: requirements },
];

export function diffVersions(eco: Ecosystem, before: Versions, after: Versions, direct: Set<string>): Change[] {
  const out: Change[] = [];
  for (const name of new Set([...before.keys(), ...after.keys()])) {
    const a = before.get(name) ?? null, b = after.get(name) ?? null;
    if (a !== b) out.push({ ecosystem: eco, package: name, from: a, to: b, direct: direct.has(name) });
  }
  return out.sort((x, y) => Number(y.direct) - Number(x.direct) || x.package.localeCompare(y.package));
}

/** Parses a bot PR's head branch or title into the update it proposes, e.g. "renovate/vite-7.x",
 *  "Update dependency vite to v7.0.1", "Bump requests from 2.31.0 to 2.32.0". */
export function updateFromTitle(title: string): { package: string; from?: string; to: string } | null {
  let m = title.match(/^(?:chore|build|fix)?(?:\([^)]*\))?:?\s*[Bb]ump ((?:@[\w.-]+\/)?[\w.-]+) from v?([\w.+-]+) to v?([\w.+-]+)/);
  if (m) return { package: m[1], from: m[2], to: m[3] };
  m = title.match(/[Uu]pdate (?:dependency )?((?:@[\w.-]+\/)?[\w.-]+) to v?([\w.+-]+)/);
  if (m) return { package: m[1], to: m[2] };
  return null;
}
