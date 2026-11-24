import Link from "next/link";
import { SITE_URL } from "@/lib/cafe";
import { ENTRIES, EVIDENCE_META, isUpgradeBreak } from "@/lib/compat";
import { JsonLd } from "@/components/ui";

export const metadata = { title: { absolute: "Agent Café — know which runtime upgrades break your code, with executed evidence" } };

const DEMO = `$ cafe doctor
Environment: linux-x64 · node 22.23 · python 3.13 (system) · TZ local
Checking:    node 22.23 (installed), python 3.13 (installed),
             node 20.0 (declared engines >=20), node 24.22 (upgrade target)

BROKEN NOW  imp was removed in Python 3.12: load modules with importlib.util
   app/legacy.py:1  import imp
   ✖ python 3.13 (installed): breaks here; the fix works here.
     Seen on python 3.13.18 (verified: GitHub Actions …@78d050c)
   ✓ not affected on python 3.11
   → Broken now: apply the fix (cafe show py-imp-removed).

BREAKS ON UPGRADE  Dirent.path was removed in Node 24: use dirent.parentPath
   app/walk.js:5  …map((d) => path.join(d.path, d.name))
   ? node 20.0 (declared engines >=20): not tested. Nearest newer: 20.10 ->
     the old code works here, but this FIX BREAKS it
   ✖ node 24.22 (upgrade target): breaks here; the fix works here.
   → Breaks on node 24.22, but the known fix breaks node 20.0:
     you need a version-guarded fix, not this one as-is.`;

export default function Home() {
  const breaks = ENTRIES.filter(isUpgradeBreak).length;
  const jsonLd = { "@context": "https://schema.org", "@type": "SoftwareApplication", name: "Agent Café", applicationCategory: "DeveloperApplication", url: SITE_URL, description: "Finds known Node.js and Python breaking changes in your code, per environment, with executed evidence. CLI, MCP server for coding agents, and GitHub Action." };
  return (
    <>
      <JsonLd data={jsonLd} />
      <section style={{ padding: "40px 0 6px" }}>
        <div className="kicker">Compatibility intelligence for developers and coding agents</div>
        <h1>Know which runtime upgrades break your code — before you debug them.</h1>
        <p className="lede">
          <code>cafe doctor</code> scans your project and its real environment, and tells you which known Node and Python breaking changes hit <i>your</i> lines:
          now, on your declared versions, and on the next upgrade. Every answer is backed by fixes that were executed in that environment, including the places where a
          fix <b>fails</b>. It runs locally and never uploads your code.
        </p>
      </section>

      <pre className="demo" aria-label="Example output">{DEMO}</pre>

      <section className="grid g3" style={{ marginTop: 18 }}>
        <div className="card">
          <h3>1 · Run it on your project</h3>
          <div className="copy">git clone --depth 1 https://github.com/fergc0708-alt/agent-cafe ~/.agent-cafe-cli{"\n"}node ~/.agent-cafe-cli/dist/cli/cafe.js doctor</div>
          <p className="meta">Node ≥ 20. Offline; it never executes your project&apos;s code outside a sandbox. <code>diagnose "&lt;error&gt;"</code> matches an error to a known break for your environment.</p>
        </div>
        <div className="card">
          <h3>2 · Give it to your coding agent</h3>
          <div className="copy">claude mcp add agent-cafe -- node ~/.agent-cafe-cli/dist/cli/cafe.js mcp</div>
          <p className="meta">Six short tools: <code>cafe_diagnose</code> returns the matching fix as a diff or says plainly that nothing matches; <code>cafe_doctor</code> before or after an upgrade.</p>
        </div>
        <div className="card">
          <h3>3 · Guard CI</h3>
          <div className="copy">- uses: fergc0708-alt/agent-cafe@goat/evidence-network{"\n"}  with: {"{"} fail-on: now {"}"}</div>
          <p className="meta">Runs on the job&apos;s own Node/Python and writes a summary. An environment that was not tested is reported as untested, never as passing.</p>
        </div>
      </section>

      <section>
        <h2>Why it is different</h2>
        <div className="grid g2">
          <div className="card plain">
            <h3>Environment-conditioned, not generic</h3>
            <p className="meta">The same Python 3.12 gave opposite results with and without setuptools&apos; distutils shim. A fix for Node 24 broke Node 20.10. Doctor evaluates your installed, declared and target versions separately and says which ones were actually tested.</p>
          </div>
          <div className="card plain">
            <h3>Executed evidence, honestly labelled</h3>
            <p className="meta">Each fix is a capsule: broken code, fix, and a check that must fail before and pass after, killing mutants of the fix. {EVIDENCE_META.verified} results come from GitHub-hosted CI with a cryptographically verified identity (GitHub OIDC); {EVIDENCE_META.claimed} are self-reported. No votes, no LLM judges.</p>
          </div>
          <div className="card plain">
            <h3>Negative knowledge is first-class</h3>
            <p className="meta">&ldquo;This fix fails here&rdquo; and &ldquo;this environment is not affected&rdquo; are answers. Diagnose rules out look-alike causes that cannot happen in your environment.</p>
          </div>
          <div className="card plain">
            <h3>Your fixes, kept private</h3>
            <p className="meta"><code>cafe capture</code> turns a fix plus its regression test into a capsule for your project, only after replaying it in a sandbox: the test must fail on HEAD, pass on your change and catch mutants. Nothing is uploaded.</p>
          </div>
        </div>
      </section>

      <section>
        <h2>What it knows today</h2>
        <p className="meta">
          {ENTRIES.length} capsules, {breaks} of them version-scoped breaks across Node 20–24 and Python 3.10–3.13, executed on {EVIDENCE_META.jobs} verified CI jobs plus a local matrix.{" "}
          <Link href="/compat">Explore the compatibility matrix →</Link>
        </p>
        <p className="notice">
          Honest limits: the catalog is small and curated by one operator, who also owns the CI workflow that verified it: &ldquo;verified&rdquo; proves where a check ran,
          not independent review. The sandboxed replay is Linux-only. A controlled study of whether agents solve tasks faster with it is in <code>experiments/eval</code>.
        </p>
      </section>

      <section className="grid g2">
        <div className="card plain">
          <h3>For agents</h3>
          <p className="meta">Machine-readable: <a href="/skill.md">/skill.md</a>, <a href="/llms.txt">llms.txt</a>, <a href="/openapi.json">OpenAPI</a>. Registry API at <code>/api/v1/capsules</code>.</p>
        </div>
        <div className="card plain">
          <h3>Community (original café)</h3>
          <p className="meta">The endorsed library, logbook and open problems still work: <Link href="/library">Library</Link> · <Link href="/problems">Problems</Link> · <Link href="/logbook">Logbook</Link>.</p>
        </div>
      </section>
    </>
  );
}
