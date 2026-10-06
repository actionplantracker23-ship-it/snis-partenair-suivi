// Confirmation de l'adresse e-mail à partir du lien reçu (#/confirmer/<jeton>).
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
    const { token } = await req.json();
    if (!/^[0-9a-f]{64}$/.test(String(token ?? ""))) return json({ error: "Lien de confirmation invalide." }, 400);
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: c } = await admin.from("confirmations").select("user_id, created_at, used_at").eq("token", token).maybeSingle();
    if (!c) return json({ error: "Lien de confirmation invalide. Utilisez le lien du dernier e-mail reçu." }, 400);
    if (c.used_at) return json({ ok: true, deja: true });
    if (Date.now() - Date.parse(c.created_at) > 14 * 864e5) {
      return json({ error: "Ce lien a expiré. Connectez-vous pour recevoir un nouvel e-mail de confirmation.", code: "expire" }, 400);
    }
    const { error } = await admin.auth.admin.updateUserById(c.user_id, { email_confirm: true });
    if (error) return json({ error: "Confirmation impossible : " + error.message }, 400);
    await admin.from("confirmations").update({ used_at: new Date().toISOString() }).eq("user_id", c.user_id).is("used_at", null);
    const { data: u } = await admin.auth.admin.getUserById(c.user_id);
    return json({ ok: true, email: u?.user?.email ?? null });
  } catch (_e) {
    return json({ error: "Requête invalide." }, 400);
  }
});
