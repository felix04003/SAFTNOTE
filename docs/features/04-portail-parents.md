# Feature 04 — Portail Parents

**Version :** v0.4.0 · Sprint 4 · 2026-03-29
**Statut :** ✅ Livré

## Résumé

Portail dédié aux parents avec login sans mot de passe (OTP SMS en 2 étapes). Permet de consulter les notes, absences et bulletins de chaque enfant. Supporte les familles multi-enfants avec un sélecteur dans la sidebar.

## Flow OTP SMS

```
1. Parent saisit téléphone + code établissement
   → POST /auth/otp/demander
   → code à 6 chiffres généré, hashé SHA-256, stocké dans otp_verifications
   → SMS envoyé (ou loggé en dev si AT_API_KEY absent)

2. Parent saisit le code à 6 chiffres
   → POST /auth/otp/valider
   → hash comparé, OTP marqué utilisé, session créée
   → redirection vers parent.html
```

## Endpoints API

| Méthode | Route | Permission | Description |
|---------|-------|------------|-------------|
| POST | `/auth/otp/demander` | public | Envoyer OTP SMS |
| POST | `/auth/otp/valider` | public | Valider OTP → session |
| GET | `/parents/moi/enfants` | parent | Liste enfants |
| GET | `/parents/moi/enfants/:id/notes` | parent | Notes d'un enfant |
| GET | `/parents/moi/enfants/:id/absences` | parent | Absences d'un enfant |
| GET | `/parents/moi/enfants/:id/bulletins` | parent | Bulletins d'un enfant |

## Fichiers concernés

**Backend :**
- `backend/src/domains/02-acteurs/auth/auth.routes.js` — routes OTP (lignes ~160–290)
- `backend/src/domains/02-acteurs/parents/parents.routes.js` — routes portail parent
- `backend/src/infrastructure/notifications/sms.service.js` — envoi SMS Africa's Talking

**Dashboard :**
- `dashboard/parent-login.html` — formulaire 2 étapes (step1 tel+code, step2 OTP)
- `dashboard/parent.html` — structure 4 pages
- `dashboard/js/par-app.js` — init + chargement enfants + sélecteur
- `dashboard/js/par-router.js` — routing hash `#par-*`
- `dashboard/js/pages/par-dashboard.js` — KPI + dernières notes + absences récentes
- `dashboard/js/pages/par-notes.js` — notes par matière + filtre période
- `dashboard/js/pages/par-absences.js` — liste absences/retards
- `dashboard/js/pages/par-bulletins.js` — bulletins trimestriels

**Base de données :**
- `otp_verifications` — (telephone, code_hash, objectif, expire_at, utilise, nb_tentatives)
- `parents_eleves` — (parent_id, eleve_id, lien) — **pas** `parent_utilisateur_id`

## Points d'attention

- `etablissements.code_officiel` — pas `.code`
- `parents_eleves` — pas `parents` — colonnes `parent_id` / `eleve_id`
- OTP max **3 tentatives** (contrainte `nb_tentatives <= 3`)
- En dev : si `AT_API_KEY` absent → OTP loggé via `logger.warn` (visible dans console backend)
- OTP valide **10 minutes** (`expire_at = NOW() + INTERVAL '10 minutes'`)

## Liens

- Spec : [`docs/superpowers/specs/2026-03-29-portail-parents-design.md`](../superpowers/specs/2026-03-29-portail-parents-design.md)
- Plan : [`docs/superpowers/plans/2026-03-29-portail-parents.md`](../superpowers/plans/2026-03-29-portail-parents.md)
