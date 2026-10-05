// Inscription d'une structure SANS e-mail de confirmation :
// le compte est créé côté serveur (confirmé), puis reste « en attente »
// jusqu'à sa validation par l'administrateur dans « Comptes utilisateurs ».
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
    const { email, password, partenaire_id } = await req.json();
    const mail = String(email ?? "").trim().toLowerCase();
    const pass = String(password ?? "");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail) || mail.length > 200) return json({ error: "Adresse email invalide." }, 400);
    if (pass.length < 8 || pass.length > 72) return json({ error: "Le mot de passe doit contenir entre 8 et 72 caractères." }, 400);
    if (!/^[0-9a-f-]{36}$/i.test(String(partenaire_id ?? ""))) return json({ error: "Choisissez votre structure." }, 400);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: structure } = await admin.from("partenaires").select("id").eq("id", partenaire_id).maybeSingle();
    if (!structure) return json({ error: "Structure inconnue." }, 400);

    const { error } = await admin.auth.admin.createUser({
      email: mail, password: pass, email_confirm: true, user_metadata: { partenaire_id },
    });
    if (error) {
      if (/already|registered|exists/i.test(error.message)) {
        return json({ error: "Un compte existe déjà pour cette adresse. Connectez-vous, ou demandez à l'administrateur un nouveau mot de passe.", code: "exists" }, 409);
      }
      return json({ error: "Inscription impossible : " + error.message }, 400);
    }
    return json({ ok: true });
  } catch (_e) {
    return json({ error: "Requête invalide." }, 400);
  }
});
