// Actions réservées à l'administrateur : attribuer un nouveau mot de passe à un compte
// (remplace le « mot de passe oublié » par e-mail).
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Méthode non autorisée." }, 405);
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const caller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: { user } } = await caller.auth.getUser();
    if (!user) return json({ error: "Session expirée : reconnectez-vous." }, 401);

    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: me } = await admin.from("profils").select("role, actif").eq("user_id", user.id).maybeSingle();
    if (!me || me.role !== "admin" || !me.actif) return json({ error: "Action réservée à l'administrateur." }, 403);

    const { action, user_id, password } = await req.json();
    if (action !== "mot_de_passe") return json({ error: "Action inconnue." }, 400);
    const pass = String(password ?? "");
    if (pass.length < 8 || pass.length > 72) return json({ error: "Le mot de passe doit contenir entre 8 et 72 caractères." }, 400);
    const { error } = await admin.auth.admin.updateUserById(String(user_id), { password: pass, email_confirm: true });
    if (error) return json({ error: "Modification impossible : " + error.message }, 400);
    return json({ ok: true });
  } catch (_e) {
    return json({ error: "Requête invalide." }, 400);
  }
});
