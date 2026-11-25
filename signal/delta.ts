// What a dependency-update branch changes: the dependency files, the version changes they imply, and whether the
// branch also changes anything else (which would make a "same code, old dependencies" baseline impossible).
import type { Change } from "./protocol.ts";
import { declared, diffVersions, LOCKFILES, updateFromTitle } from "./lockfiles.ts";
import { git, where } from "./exec.ts";

const MANIFESTS = /(^|\/)(package\.json|pyproject\.toml|setup\.cfg|requirements[^/]*\.(txt|in))$/;
const MAX_FILE = 32 << 20;

export interface Delta {
  base: string;
  root: string;
  prefix: string;
  files: string[]; // dependency files that differ (repo-relative)
  otherFiles: string[]; // non-dependency files that differ inside the project
  changes: Change[];
  direct: Change[]; // version changes of declared dependencies (added/removed included)
  primary: Change | null; // the update the PR title names, if any
}

function relevant(name: string, prefix: string): boolean {
  if (name.startsWith(prefix)) return true;
  const d = name.includes("/") ? name.slice(0, name.lastIndexOf("/") + 1) : "";
  // workspaces: the lockfile and the root manifest live in an ancestor directory, and must be reverted together
  return (LOCKFILES.some((l) => l.match.test(name)) || /(^|\/)(package\.json|pyproject\.toml)$/.test(name)) && prefix.startsWith(d);
}

/** "auto": the first parent of a PR merge commit is exactly the base the PR is tested against. */
export function resolveBase(dir: string, base: string): string {
  if (base !== "auto") return base;
  const parents = git(dir, ["rev-list", "--parents", "-n", "1", "HEAD"]).out.trim().split(" ");
  if (parents.length === 3) return parents[1];
  for (const b of ["origin/HEAD", "origin/main", "origin/master", "main", "master"]) if (git(dir, ["rev-parse", "--verify", "-q", `${b}^{commit}`]).ok) return b;
  return "origin/main";
}

export function dependencyDelta(dir: string, baseRef: string, title?: string): Delta {
  const { root, prefix } = where(dir);
  const base = resolveBase(dir, baseRef);
  if (!git(root, ["rev-parse", "--verify", "-q", `${base}^{commit}`]).ok) throw new Error(`base ref "${base}" not found. In CI, check out with fetch-depth: 2 (Signal compares the PR merge commit with its first parent), or pass --base <ref>.`);
  const names = git(root, ["diff", "--name-only", "--no-renames", base, "HEAD"]).out.split("\n").filter(Boolean);
  const files = names.filter((n) => (LOCKFILES.some((l) => l.match.test(n)) || MANIFESTS.test(n)) && relevant(n, prefix));
  const otherFiles = names.filter((n) => n.startsWith(prefix) && !files.includes(n));
  const directNames = new Set<string>();
  // The project's own manifest declares the direct dependencies even when the PR only touches the lockfile
  // (in-range bumps, lockfile maintenance).
  const manifests = new Set(files.filter((n) => MANIFESTS.test(n)));
  for (const m of ["package.json", "pyproject.toml", "requirements.txt", "requirements-dev.txt"]) if (git(root, ["cat-file", "-e", `HEAD:${prefix}${m}`]).ok) manifests.add(prefix + m);
  for (const f of manifests) {
    for (const ref of [base, "HEAD"]) for (const n of declared(f, git(root, ["show", `${ref}:${f}`]).out.slice(0, MAX_FILE))) directNames.add(n);
  }
  const changes: Change[] = [];
  for (const f of files) {
    const l = LOCKFILES.find((x) => x.match.test(f));
    if (!l) continue;
    const before = l.parse(git(root, ["show", `${base}:${f}`]).out.slice(0, MAX_FILE));
    const after = l.parse(git(root, ["show", `HEAD:${f}`]).out.slice(0, MAX_FILE));
    changes.push(...diffVersions(l.ecosystem, before, after, directNames));
  }
  const seen = new Set<string>();
  const uniq = changes.filter((c) => { const k = `${c.ecosystem}:${c.package}:${c.from}:${c.to}`; return seen.has(k) ? false : (seen.add(k), true); });
  const direct = uniq.filter((c) => c.direct);
  const t = title ? updateFromTitle(title) : null;
  const want = t?.package.toLowerCase().replace(/[-_.]+/g, "-");
  const primary = (want && uniq.find((c) => c.package.replace(/[-_.]+/g, "-") === want)) || (direct.length === 1 ? direct[0] : null);
  return { base, root, prefix, files, otherFiles, changes: uniq, direct, primary: primary ?? null };
}
