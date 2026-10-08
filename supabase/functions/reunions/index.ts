// Invitations aux réunions des partenaires (réservé à l'administrateur).
// Destinataires : comptes validés des structures concernées + e-mails des fiches partenaires.
// Si Brevo est configuré (BREVO_API_KEY, BREVO_SENDER_EMAIL), l'invitation est envoyée avec
// un fichier agenda (.ics) ; sinon la liste des destinataires est renvoyée à l'application,
// qui ouvre la messagerie de l'administrateur.
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
const esc = (s: string) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const dateFr = (d: string) => { const [y, m, j] = d.split("-").map(Number); return `${j} ${MOIS[m - 1]} ${y}`; };
const hh = (t?: string | null) => (t ? t.slice(0, 5).replace(":", "h") : "");

function ics(r: any) {
  // Heure du Burkina Faso = UTC (pas d'heure d'été)
  const d = r.date.replaceAll("-", "");
  const t = (x: string | null, def: string) => (x ? x.slice(0, 5).replace(":", "") + "00" : def);
  const txt = (s: string) => String(s ?? "").replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/[,;]/g, (c) => "\\" + c);
  const now = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Plan des partenaires SNIS//FR", "METHOD:PUBLISH", "BEGIN:VEVENT",
    `UID:${r.id}@snis-partenaires`, `DTSTAMP:${now}`,
    r.heure_debut ? `DTSTART:${d}T${t(r.heure_debut, "090000")}Z` : `DTSTART;VALUE=DATE:${d}`,
    r.heure_debut ? `DTEND:${d}T${t(r.heure_fin, t(r.heure_debut, "090000"))}Z` : `DTEND;VALUE=DATE:${d}`,
    `SUMMARY:${txt(r.titre)}`, `LOCATION:${txt(r.lieu || r.lien_visio || "")}`,
    `DESCRIPTION:${txt((r.ordre_du_jour || "") + (r.lien_visio ? "\n\nLien : " + r.lien_visio : ""))}`,
    "END:VEVENT", "END:VCALENDAR"].join("\r\n");
}

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
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: me } = await admin.from("profils").select("role, actif").eq("user_id", user.id).maybeSingle();
    if (!me || me.role !== "admin" || !me.actif) return json({ error: "Action réservée à l'administrateur." }, 403);

    const { action, reunion_id } = await req.json();
    if (action !== "inviter") return json({ error: "Action inconnue." }, 400);
    const { data: r } = await admin.from("reunions").select("*").eq("id", reunion_id).maybeSingle();
    if (!r) return json({ error: "Réunion introuvable." }, 404);

    const parts: string[] = r.partenaires ?? [];
    const dest = new Set<string>();
    if (parts.length) {
      const { data: comptes } = await admin.from("profils").select("email").in("partenaire_id", parts).eq("actif", true);
      for (const c of comptes ?? []) if (c.email) dest.add(c.email.toLowerCase());
      const { data: fiches } = await admin.from("partenaires").select("email").in("id", parts);
      for (const f of fiches ?? []) for (const e of String(f.email ?? "").split(/[,;\s]+/)) if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) dest.add(e.toLowerCase());
    }
    const destinataires = [...dest].sort();
    if (!destinataires.length) return json({ error: "Aucune adresse e-mail trouvée pour les partenaires concernés. Renseignez l'e-mail des partenaires ou faites valider leurs comptes." }, 400);
    if (!Deno.env.get("BREVO_API_KEY") || !Deno.env.get("BREVO_SENDER_EMAIL")) return json({ ok: true, envoye: false, destinataires });

    const quand = `${dateFr(r.date)}${r.heure_debut ? ", de " + hh(r.heure_debut) + (r.heure_fin ? " à " + hh(r.heure_fin) : "") : ""}`;
    const html = `<!doctype html><html lang="fr"><body style="margin:0;background:#f4f6f5;font-family:Georgia,'Times New Roman',serif;color:#1f1f1f">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f5;padding:24px 0"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border:1px solid #dfe6e1">
<tr><td style="background:#00873E;color:#ffffff;padding:18px 28px;font-size:20px">${APP}</td></tr>
<tr><td style="height:4px;background:#FCD116;font-size:0;line-height:0">&nbsp;</td></tr>
<tr><td style="padding:28px"><p style="margin:0 0 6px;color:#6b7280;font-size:14px">Invitation à une réunion</p>
<h1 style="margin:0 0 18px;font-size:22px;font-weight:normal;color:#00602C">${esc(r.titre)}</h1>
<table role="presentation" style="font-size:16px;line-height:1.6"><tr><td style="padding-right:12px;color:#6b7280">Date</td><td><b>${esc(quand)}</b></td></tr>
${r.lieu ? `<tr><td style="padding-right:12px;color:#6b7280">Lieu</td><td>${esc(r.lieu)}</td></tr>` : ""}
${r.lien_visio ? `<tr><td style="padding-right:12px;color:#6b7280">En ligne</td><td><a href="${esc(r.lien_visio)}">${esc(r.lien_visio)}</a></td></tr>` : ""}</table>
${r.ordre_du_jour ? `<p style="margin:20px 0 6px;font-weight:bold">Ordre du jour</p><div style="white-space:pre-wrap;font-size:15px;line-height:1.55">${esc(r.ordre_du_jour)}</div>` : ""}
<p style="margin:24px 0 0;font-size:14px;color:#6b7280">Le fichier joint (invitation.ics) ajoute la réunion à votre agenda.</p>
<p style="margin:24px 0"><a href="${SITE}#/reunion/${r.id}" style="background:#00873E;color:#ffffff;text-decoration:none;padding:13px 24px;border-radius:4px;font-size:16px;display:inline-block">Voir sur la plateforme</a></p></td></tr>
<tr><td style="padding:16px 28px;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280">Message envoyé depuis la plateforme ${APP}.</td></tr>
</table></td></tr></table></body></html>`;
    const piece = btoa(unescape(encodeURIComponent(ics(r))));
    let ok = 0; const echecs: string[] = [];
    for (const d of destinataires) {
      let statut = "envoye", detail = "";
      try {
        const res = await fetch("https://api.brevo.com/v3/smtp/email", {
          method: "POST",
          headers: { "api-key": Deno.env.get("BREVO_API_KEY")!, "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({ sender: { email: Deno.env.get("BREVO_SENDER_EMAIL"), name: Deno.env.get("BREVO_SENDER_NAME") || APP },
            to: [{ email: d }], subject: `Invitation : ${r.titre} — ${dateFr(r.date)}`, htmlContent: html,
            attachment: [{ name: "invitation.ics", content: piece }] }),
        });
        if (!res.ok) { statut = "echec"; detail = `${res.status} ${(await res.text()).slice(0, 300)}`; }
      } catch (e) { statut = "echec"; detail = String(e).slice(0, 300); }
      await admin.from("journal_emails").insert({ destinataire: d, objet: "Invitation réunion : " + r.titre, statut, detail });
      if (statut === "envoye") ok++; else echecs.push(d);
    }
    if (ok) await admin.from("reunions").update({ invitation_envoyee_le: new Date().toISOString() }).eq("id", r.id);
    return json({ ok: true, envoye: ok > 0, nb: ok, echecs, destinataires });
  } catch (_e) {
    return json({ error: "Requête invalide." }, 400);
  }
});
