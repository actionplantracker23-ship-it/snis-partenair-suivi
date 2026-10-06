-- Comptes par structure, rôles (partenaire / admin) et droits de modification.
-- Appliqué sur le projet Supabase. Principe :
--   * tout compte connecté lit l'ensemble des données (tableau de bord) ;
--   * une structure (compte validé) ne modifie que les activités qui la concernent ;
--   * l'administrateur modifie tout, valide les comptes et supprime.

create table if not exists public.profils (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  partenaire_id uuid references public.partenaires(id) on delete set null,
  role text not null default 'partenaire' check (role in ('partenaire','admin')),
  actif boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.profils enable row level security;

create or replace function public.est_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profils where user_id = auth.uid() and role = 'admin' and actif);
$$;
create or replace function public.ma_structure() returns uuid
language sql stable security definer set search_path = '' as $$
  select partenaire_id from public.profils where user_id = auth.uid() and actif;
$$;
create or replace function public.peut_modifier(parts uuid[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.est_admin() or coalesce(public.ma_structure() = any(parts), false);
$$;
create or replace function public.peut_modifier_tache(tid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.est_admin()
      or exists (select 1 from public.taches t where t.id = tid and public.ma_structure() = any(t.partenaires));
$$;

-- Liste des structures affichée sur l'écran de connexion (avant authentification)
create or replace function public.liste_structures() returns table(id uuid, nom text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.nom from public.partenaires p order by p.nom;
$$;
revoke all on function public.liste_structures() from public;
grant execute on function public.liste_structures() to anon, authenticated;

-- Appelée par l'application à la connexion : crée le profil (en attente de validation)
-- à partir de la structure choisie lors de l'inscription.
create or replace function public.creer_mon_profil() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then return; end if;
  insert into public.profils (user_id, email, partenaire_id)
  select u.id, u.email,
         (select p.id from public.partenaires p where p.id::text = u.raw_user_meta_data->>'partenaire_id')
  from auth.users u where u.id = auth.uid()
  on conflict (user_id) do nothing;
end $$;
revoke all on function public.creer_mon_profil() from public, anon;
grant execute on function public.creer_mon_profil() to authenticated;

-- Politiques (les politiques « equipe_* » d'origine sont réutilisées pour l'écriture)
alter policy equipe_taches on public.taches to authenticated
  using (public.peut_modifier(partenaires)) with check (public.peut_modifier(partenaires));
create policy taches_lecture on public.taches for select to authenticated using (true);
create policy taches_suppr_admin on public.taches as restrictive for delete to authenticated using (public.est_admin());

alter policy equipe_partenaires on public.partenaires to authenticated
  using (public.est_admin() or id = public.ma_structure()) with check (public.est_admin() or id = public.ma_structure());
create policy partenaires_lecture on public.partenaires for select to authenticated using (true);
create policy partenaires_ajout_admin on public.partenaires as restrictive for insert to authenticated with check (public.est_admin());
create policy partenaires_suppr_admin on public.partenaires as restrictive for delete to authenticated using (public.est_admin());

alter policy equipe_notes on public.notes to authenticated
  using (public.peut_modifier_tache(tache_id)) with check (public.peut_modifier_tache(tache_id));
create policy notes_lecture on public.notes for select to authenticated using (true);

alter policy equipe_produits on public.produits to authenticated
  using (public.peut_modifier_tache(tache_id)) with check (public.peut_modifier_tache(tache_id));
create policy produits_lecture on public.produits for select to authenticated using (true);

create policy profils_lecture on public.profils for select to authenticated using (user_id = auth.uid() or public.est_admin());
create policy profils_admin_maj on public.profils for update to authenticated using (public.est_admin()) with check (public.est_admin());

alter policy equipe_envoi_fichiers on storage.objects to authenticated
  with check (bucket_id = 'fichiers' and (public.est_admin() or public.ma_structure() is not null));
alter policy equipe_suppr_fichiers on storage.objects to authenticated
  using (bucket_id = 'fichiers' and public.est_admin());

-- Premier administrateur
-- insert into public.profils (user_id, email, role, actif)
-- select id, email, 'admin', true from auth.users where email = 'ADRESSE_ADMIN'
-- on conflict (user_id) do update set role = 'admin', actif = true;

-- Création du profil dès l'inscription (en attente de validation), pour que l'administrateur
-- voie tout de suite le compte, même si l'utilisateur n'a pas encore ouvert l'application.
create or replace function public.creer_profil_inscription() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profils (user_id, email, partenaire_id)
  values (new.id, new.email, (select p.id from public.partenaires p where p.id::text = new.raw_user_meta_data->>'partenaire_id'))
  on conflict (user_id) do nothing;
  return new;
exception when others then
  return new; -- ne jamais bloquer une inscription
end $$;
create trigger creer_profil_a_l_inscription after insert on auth.users
  for each row execute function public.creer_profil_inscription();

-- Accès réservé aux comptes validés : un compte en attente ne lit aucune donnée
-- (ni activités, ni partenaires, ni tableau de bord) ; il ne voit que son propre profil.
create or replace function public.est_actif() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profils where user_id = auth.uid() and actif);
$$;
alter policy taches_lecture on public.taches to authenticated using (public.est_actif());
alter policy partenaires_lecture on public.partenaires to authenticated using (public.est_actif());
alter policy notes_lecture on public.notes to authenticated using (public.est_actif());
alter policy produits_lecture on public.produits to authenticated using (public.est_actif());

-- E-mails de confirmation envoyés par les fonctions « inscription » et « confirmer » (Brevo)
create table if not exists public.confirmations (
  token text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  used_at timestamptz
);
alter table public.confirmations enable row level security;   -- accès serveur uniquement
create table if not exists public.journal_emails (
  id bigint generated always as identity primary key,
  destinataire text, objet text, statut text, detail text,
  created_at timestamptz not null default now()
);
alter table public.journal_emails enable row level security;  -- accès serveur uniquement
create or replace function public.compte_par_email(adresse text) returns table(id uuid, confirme boolean)
language sql stable security definer set search_path = '' as $$
  select u.id, u.email_confirmed_at is not null from auth.users u where lower(u.email) = lower(adresse) limit 1;
$$;
revoke all on function public.compte_par_email(text) from public, anon, authenticated;
grant execute on function public.compte_par_email(text) to service_role;
