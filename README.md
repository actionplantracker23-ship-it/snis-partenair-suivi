# Plan des partenaires SNIS

Site : https://actionplantracker23-ship-it.github.io/snis-partenair-suivi/

## Accès

- **Connexion** : nom de la structure, adresse email et mot de passe.
- **Créer un compte** : chaque structure crée son compte depuis l'écran de connexion. Le compte reste
  « en attente » jusqu'à sa validation par l'administrateur (menu ☰ → *Comptes utilisateurs*).
- **Droits** :
  - une structure validée met à jour uniquement les activités qui la concernent (et sa fiche partenaire) ;
  - l'administrateur modifie toutes les activités, valide les comptes, attribue les structures et les rôles,
    et seul il peut supprimer ;
  - tout compte connecté consulte le **tableau de bord** (avancement global, par partenaire, par pilier,
    retards et échéances).

Les règles sont appliquées dans la base Supabase (Row Level Security), voir `supabase/roles_structures.sql`.

## Réglages Supabase (Authentication)

- *URL Configuration* : Site URL = l'adresse du site ci-dessus, et la même adresse suivie de `**` dans Redirect URLs.
- *Sign In / Providers → Email* : laisser activé. « Confirm email » peut rester activé (l'utilisateur confirme
  son adresse puis se connecte).
  Sera completer, application en cour de developpement

## Contributeurs

- Action Plan Tracker ([@actionplantracker23-ship-it](https://github.com/actionplantracker23-ship-it)) : conception, pilotage et validation
- Claude (Anthropic) : développement
