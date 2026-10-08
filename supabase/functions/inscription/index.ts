// Inscription d'une structure avec e-mail de confirmation, sans limite d'envoi Supabase :
// le compte est créé côté serveur, l'e-mail est envoyé par Brevo (API transactionnelle).
// Le compte reste ensuite « en attente » jusqu'à sa validation par l'administrateur.
//
// Secrets (Supabase → Edge Functions → Secrets) :
//   BREVO_API_KEY       clé API Brevo
//   BREVO_SENDER_EMAIL  adresse d'expéditeur validée dans Brevo
//   BREVO_SENDER_NAME   (facultatif) nom affiché de l'expéditeur
// Sans ces secrets, le compte est confirmé d'office : l'inscription n'est jamais bloquée.
import { createClient } from "npm:@supabase/supabase-js@2";

const SITE = "https://actionplantracker23-ship-it.github.io/snis-partenair-suivi/";
const APP = "Plan des partenaires SNIS";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const mailerReady = () => !!(Deno.env.get("BREVO_API_KEY") && Deno.env.get("BREVO_SENDER_EMAIL"));

function gabarit(titre: string, corps: string, bouton?: { texte: string; lien: string }) {
  return `<!doctype html><html lang="fr"><body style="margin:0;background:#f4f6f5;font-family:Georgia,'Times New Roman',serif;color:#1f1f1f">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f5;padding:24px 0"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border:1px solid #dfe6e1">
<tr><td style="background:#00873E;color:#ffffff;padding:18px 28px;font-size:20px">${APP}</td></tr>
<tr><td style="height:4px;background:#FCD116;font-size:0;line-height:0">&nbsp;</td></tr>
<tr><td style="padding:28px">
<h1 style="margin:0 0 16px;font-size:22px;font-weight:normal;color:#00602C">${titre}</h1>
<div style="font-size:16px;line-height:1.55">${corps}</div>
${bouton ? `<p style="margin:28px 0"><a href="${bouton.lien}" style="background:#00873E;color:#ffffff;text-decoration:none;padding:13px 24px;border-radius:4px;font-size:16px;display:inline-block">${bouton.texte}</a></p>
<p style="font-size:13px;color:#6b7280;line-height:1.5">Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :<br><span style="word-break:break-all">${bouton.lien}</span></p>` : ""}
</td></tr>
<tr><td style="padding:16px 28px;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280">Message automatique de la plateforme ${APP}. Merci de ne pas y répondre.</td></tr>
</table></td></tr></table></body></html>`;
}

async function envoyer(dest: string, objet: string, html: string): Promise<boolean> {
  let statut = "envoye", detail = "";
  try {
    const r = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": Deno.env.get("BREVO_API_KEY")!, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        sender: { email: Deno.env.get("BREVO_SENDER_EMAIL"), name: Deno.env.get("BREVO_SENDER_NAME") || APP },
        to: [{ email: dest }], subject: objet, htmlContent: html,
      }),
    });
    if (!r.ok) { statut = "echec"; detail = `${r.status} ${(await r.text()).slice(0, 300)}`; }
  } catch (e) { statut = "echec"; detail = String(e).slice(0, 300); }
  await admin.from("journal_emails").insert({ destinataire: dest, objet, statut, detail });
  return statut === "envoye";
}

async function envoyerConfirmation(userId: string, email: string): Promise<boolean> {
  const token = crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
  await admin.from("confirmations").insert({ token, user_id: userId });
  const lien = `${SITE}#/confirmer/${token}`;
  return await envoyer(email, `Confirmez votre inscription à la plateforme ${APP}`, gabarit(
    "Confirmez votre adresse e-mail",
    `<p>Bonjour,</p><p>Une inscription à la plateforme <b>${APP}</b> a été demandée avec l'adresse <b>${esc(email)}</b>.</p>
     <p>Cliquez sur le bouton ci-dessous pour confirmer votre adresse. Votre compte sera ensuite examiné par l'administrateur, qui vous donnera accès à la plateforme.</p>
     <p style="color:#6b7280;font-size:14px">Si vous n'êtes pas à l'origine de cette demande, ignorez simplement ce message.</p>`,
    { texte: "Confirmer mon adresse", lien },
  ));
}

async function prevenirAdmins(email: string, structure: string) {
  const { data } = await admin.from("profils").select("email").eq("role", "admin").eq("actif", true);
  for (const a of data ?? []) {
    if (!a.email) continue;
    await envoyer(a.email, `Nouvelle inscription à valider : ${structure}`, gabarit(
      "Nouvelle inscription à valider",
      `<p>Un compte vient d'être créé sur la plateforme :</p>
       <p><b>Structure :</b> ${esc(structure)}<br><b>Adresse :</b> ${esc(email)}</p>
       <p>Ouvrez « Comptes utilisateurs » pour vérifier ce compte et le valider.</p>`,
      { texte: "Ouvrir les comptes utilisateurs", lien: `${SITE}#/comptes` },
    ));
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Méthode non autorisée." }, 405);
  try {
    const body = await req.json();
    const mail = String(body.email ?? "").trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail) || mail.length > 200) return json({ error: "Adresse email invalide." }, 400);

    // Renvoyer l'e-mail de confirmation (réponse identique dans tous les cas)
    if (body.action === "renvoyer") {
      const { data } = await admin.rpc("compte_par_email", { adresse: mail });
      const c = data?.[0];
      if (c && !c.confirme && mailerReady()) await envoyerConfirmation(c.id, mail);
      return json({ ok: true });
    }

    const pass = String(body.password ?? "");
    const partenaire_id = String(body.partenaire_id ?? "");
    if (pass.length < 8 || pass.length > 72) return json({ error: "Le mot de passe doit contenir entre 8 et 72 caractères." }, 400);
    if (!/^[0-9a-f-]{36}$/i.test(partenaire_id)) return json({ error: "Choisissez votre structure." }, 400);
    const { data: structure } = await admin.from("partenaires").select("id, nom").eq("id", partenaire_id).maybeSingle();
    if (!structure) return json({ error: "Structure inconnue." }, 400);

    // Adresse déjà inscrite : si elle n'est pas confirmée, on renvoie simplement l'e-mail
    const { data: existant } = await admin.rpc("compte_par_email", { adresse: mail });
    if (existant?.[0]) {
      if (!existant[0].confirme && mailerReady() && await envoyerConfirmation(existant[0].id, mail)) {
        return json({ ok: true, confirmation: "envoyee" });
      }
      return json({ error: "Un compte existe déjà pour cette adresse. Connectez-vous, ou demandez à l'administrateur un nouveau mot de passe.", code: "exists" }, 409);
    }

    const avecEmail = mailerReady();
    const { data: cree, error } = await admin.auth.admin.createUser({
      email: mail, password: pass, email_confirm: !avecEmail, user_metadata: { partenaire_id },
    });
    if (error || !cree?.user) return json({ error: "Inscription impossible : " + (error?.message ?? "erreur inconnue") }, 400);

    let confirmation = "aucune";
    if (avecEmail) {
      if (await envoyerConfirmation(cree.user.id, mail)) confirmation = "envoyee";
      else await admin.auth.admin.updateUserById(cree.user.id, { email_confirm: true }); // jamais bloqué
    }
    if (avecEmail) await prevenirAdmins(mail, structure.nom);
    return json({ ok: true, confirmation });
  } catch (_e) {
    return json({ error: "Requête invalide." }, 400);
  }
});
