export const nowIso = (): string => new Date().toISOString();

export const today = (d: Date = new Date()): string => d.toISOString().slice(0, 10);

export function addDays(iso: string, days: number): string {
  return new Date(new Date(iso).getTime() + days * 86_400_000).toISOString();
}

export function uuid(): string {
  return crypto.randomUUID();
}

export function slugify(text: string): string {
  const base = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (base.length <= 64) return base || "item";
  const cut = base.slice(0, 64);
  const lastDash = cut.lastIndexOf("-");
  return (lastDash > 30 ? cut.slice(0, lastDash) : cut).replace(/-+$/g, "");
}

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

export function randomToken(len = 32): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

export async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function normalizeQuery(q: string): string {
  return q
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

export function tokenize(text: string): string[] {
  return normalizeQuery(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 1);
}

export function unique<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

export function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === "number" ? v : parseInt(String(v ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}
