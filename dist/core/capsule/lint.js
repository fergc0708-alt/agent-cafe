// Static anti-vacuity heuristics. They never prove a check is good; they flag checks that are
// probably bad so the dynamic gates (fail->pass, mutation sensitivity) get extra scrutiny.
import { changedFiles } from "./capsule.js";
const FAILURE_PATH = {
    node: /\bassert\b|\bthrow\b|process\.exit\(\s*[1-9]|process\.exitCode\s*=\s*[1-9]/,
    bun: /\bassert\b|\bthrow\b|process\.exit\(\s*[1-9]|process\.exitCode\s*=\s*[1-9]/,
    python: /\bassert\b|\braise\b|sys\.exit\(\s*[1-9"']|SystemExit\(\s*[1-9"']/,
    bash: /\bexit\s+[1-9]|\bfalse\b|\btest\b|\[\[?|set -e/,
};
const EXISTENCE_ONLY = [/existsSync\(/, /os\.path\.(exists|isfile)\(/, /Path\([^)]*\)\.exists\(/, /\btest -[ef]\b/, /\[ -[ef] /];
const TEXT_INSPECTION = [/readFileSync\(/, /\.read_text\(/, /open\([^)]*\)\.read\(/, /\bgrep\b/];
export function lintCapsule(c) {
    const out = [];
    const checkSrc = Object.values(c.check.files).join("\n");
    const changed = changedFiles(c);
    if (changed.length === 0)
        out.push({ code: "no_change", severity: "error", message: "after.files is identical to before.files." });
    if (!Object.keys(c.before.files).length) {
        out.push({ code: "no_before_state", severity: "warning", message: "No before state: the check cannot be shown to fail without the fix." });
    }
    const rt = c.runtime === "bun" ? "node" : c.runtime;
    if (!FAILURE_PATH[rt].test(checkSrc)) {
        out.push({ code: "no_failure_path", severity: "warning", message: "The check has no visible way to fail (no assert/throw/non-zero exit)." });
    }
    const stems = changed.map((p) => p.split("/").at(-1).replace(/\.[^.]+$/, ""));
    if (stems.length && !stems.some((s) => checkSrc.includes(s))) {
        out.push({ code: "does_not_reference_fix", severity: "warning", message: `The check never mentions the changed files (${changed.join(", ")}).` });
    }
    // "Behavioral use" = the check imports, requires or executes one of the changed files.
    const usesFix = stems.some((st) => {
        const e = st.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return new RegExp(`(from\\s+${e}\\s+import|import\\s+${e}\\b|require\\(["'\`]\\.\\/${e}|["'\`]\\.?\\/?${e}\\.[a-z]+["'\`]\\s*[,\\]]|bash\\s+${e}\\.|source\\s+\\.?\\/?${e})`).test(checkSrc);
    });
    if (EXISTENCE_ONLY.some((r) => r.test(checkSrc)) && !usesFix) {
        out.push({ code: "existence_only", severity: "warning", message: "The check seems to test that files exist, not how they behave." });
    }
    if (TEXT_INSPECTION.some((r) => r.test(checkSrc)) && changed.some((f) => checkSrc.includes(f))) {
        out.push({
            code: "text_inspection",
            severity: "warning",
            message: "The check reads a solution file as text. Mutation testing cannot tell text matching from behavior.",
        });
    }
    return out;
}
