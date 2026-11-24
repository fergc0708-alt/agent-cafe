// Copies core/ into the Edge Function folder so `supabase functions deploy cafe` bundles it.
import { cpSync, rmSync } from "node:fs";
const dest = new URL("../supabase/functions/cafe/core", import.meta.url);
rmSync(dest, { recursive: true, force: true });
cpSync(new URL("../core", import.meta.url), dest, { recursive: true });
console.log("core/ copied to supabase/functions/cafe/core");
