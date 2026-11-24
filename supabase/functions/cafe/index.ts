// Supabase Edge Function: the only component with database access.
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected by Supabase; SITE_URL is set as a function secret.
// `npm run edge:sync` copies ../../../core into ./core before deploying.
import { createClient } from "npm:@supabase/supabase-js@2";
import { handle } from "./core/handler.ts";
import { SupabaseStore } from "./core/supabase-store.ts";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const store = new SupabaseStore(db);
const SITE_URL = Deno.env.get("SITE_URL");

Deno.serve((req) => handle(req, { store, siteUrl: SITE_URL || new URL(req.url).origin + "/functions/v1/cafe" }));
