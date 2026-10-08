// Actions réservées à l'administrateur :
//   mot_de_passe          attribuer un mot de passe provisoire à un compte
//   notifier_validation   prévenir par e-mail (Brevo) la personne dont le compte vient d'être validé
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const SITE = "https://actionplantracker23-ship-it.github.io/snis-partenair-suivi/";
const APP = "Plan des partenaires SNIS";

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
    if (action === "notifier_validation") {
      if (!Deno.env.get("BREVO_API_KEY") || !Deno.env.get("BREVO_SENDER_EMAIL")) return json({ ok: true, envoye: false });
      const { data: u } = await admin.auth.admin.getUserById(String(user_id));
      const dest = u?.user?.email;
      if (!dest) return json({ ok: true, envoye: false });
      const html = `<!doctype html><html lang="fr"><body style="margin:0;background:#f4f6f5;font-family:Georgia,'Times New Roman',serif;color:#1f1f1f">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f5;padding:24px 0"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border:1px solid #dfe6e1">
<tr><td style="background:#00873E;color:#ffffff;padding:18px 28px;font-size:20px">${APP}</td></tr>
<tr><td style="height:4px;background:#FCD116;font-size:0;line-height:0">&nbsp;</td></tr>
<tr><td style="padding:28px"><h1 style="margin:0 0 16px;font-size:22px;font-weight:normal;color:#00602C">Votre compte est validé</h1>
<div style="font-size:16px;line-height:1.55"><p>Bonjour,</p><p>L'administrateur a validé votre compte sur la plateforme <b>${APP}</b>. Vous pouvez maintenant vous connecter avec votre structure, votre adresse e-mail et votre mot de passe.</p></div>
<p style="margin:28px 0"><a href="${SITE}" style="background:#00873E;color:#ffffff;text-decoration:none;padding:13px 24px;border-radius:4px;font-size:16px;display:inline-block">Accéder à la plateforme</a></p></td></tr>
<tr><td style="padding:16px 28px;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280">Message automatique de la plateforme ${APP}. Merci de ne pas y répondre.</td></tr>
</table></td></tr></table></body></html>`;
      let statut = "envoye", detail = "";
      try {
        const r = await fetch("https://api.brevo.com/v3/smtp/email", {
          method: "POST",
          headers: { "api-key": Deno.env.get("BREVO_API_KEY")!, "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({ sender: { email: Deno.env.get("BREVO_SENDER_EMAIL"), name: Deno.env.get("BREVO_SENDER_NAME") || APP },
            to: [{ email: dest }], subject: `Votre compte est validé sur la plateforme ${APP}`, htmlContent: html }),
        });
        if (!r.ok) { statut = "echec"; detail = `${r.status} ${(await r.text()).slice(0, 300)}`; }
      } catch (e) { statut = "echec"; detail = String(e).slice(0, 300); }
      await admin.from("journal_emails").insert({ destinataire: dest, objet: "Compte validé", statut, detail });
      return json({ ok: true, envoye: statut === "envoye" });
    }
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
