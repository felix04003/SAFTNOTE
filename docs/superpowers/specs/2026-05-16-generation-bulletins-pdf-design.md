# Design — Génération PDF des bulletins scolaires

**Date :** 2026-05-16
**Statut :** Validé
**Approche retenue :** BullMQ + Puppeteer + Cloudflare R2 + polling

---

## Contexte

L'endpoint `POST /bulletins/generer` marque les bulletins comme `bulletin_genere = true` en base mais ne génère aucun fichier PDF. `GET /bulletins/:id/download` retourne toujours 404 car `bulletin_url` est toujours `null`. Le worker `generation-bulletins.worker.js` est un stub vide (Phase 3 non commencée).

---

## Décisions

| Question | Décision |
|----------|----------|
| Qui peut télécharger ? | Directeur + Parents + Enseignants |
| Stockage | Cloudflare R2 (gratuit jusqu'à 10 GB, zéro frais de sortie réseau) |
| Design du bulletin | Simple et fonctionnel (entête, tableau notes, mentions) |
| Mode de génération | Asynchrone via BullMQ (queue `generation-bulletins` déjà câblée) |

---

## Architecture & flux

```
POST /bulletins/generer (directeur)
  1. Vérifie que les moyennes existent pour la classe
  2. SET bulletin_genere = true en DB (comme avant)
  3. Enqueue job BullMQ { classe_id, periode_id, etablissement_id }  ← NOUVEAU
  4. Répond 202 { message, nb_bulletins }

        │ queue: generation-bulletins
        ▼

Worker generation-bulletins.worker.js
  Pour chaque élève de la classe :
    1. Fetch toutes les données du bulletin (élève, notes, établissement)
    2. Render HTML via bulletin.template.js → chaîne HTML
    3. Puppeteer : HTML string → PDF buffer (A4 portrait)
    4. Upload PDF vers Cloudflare R2 → URL publique
    5. UPDATE moyennes_generales SET bulletin_url = '<url>' WHERE id = ...
  BullMQ : retry x3 automatique (backoff exponentiel 2s → 4s → 8s)

GET /bulletins/:id/download (directeur / parent / enseignant)
  • bulletin_url != null  → { download_url, expire_dans: '1h' }
  • bulletin_url == null  → 404 "PDF en cours de génération"
  • bulletin non validé   → 403 "Bulletin non encore validé"
```

---

## Fichiers à créer

### `backend/src/infrastructure/storage/r2.service.js`
Client Cloudflare R2 via le SDK AWS S3-compatible (`@aws-sdk/client-s3`).

```js
// Interface publique
uploadPDF(buffer, key)  → Promise<string>  // retourne l'URL publique
```

Variables d'env requises : `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_PUBLIC_URL`.

Mode dev sans R2 : si les variables sont absentes, écrit le PDF dans `/tmp/bulletins/` et retourne un chemin local `local:///tmp/bulletins/<key>`.

### `backend/src/templates/bulletin.template.js`
Fonction pure qui reçoit les données et retourne une chaîne HTML.

```js
// Interface publique
genererHTML(data) → string
// data = { etablissement, eleve, periode, matieres, conduite, resultat, absences }
```

**Structure visuelle (A4 portrait, CSS inline) :**
```
┌────────────────────────────────────────────┐
│ [Logo]  NOM ÉTABLISSEMENT                  │
│         Ville • Tél • Année scolaire       │
├────────────────────────────────────────────┤
│ BULLETIN DE NOTES — Trimestre N            │
│ Élève : Prénom NOM    Matricule : EL-001   │
│ Classe : Terminale S1   Rang : 3 / 42      │
├──────────────┬──────┬──────┬───────────────┤
│ Matière      │ Coef │ Note │ Appréciation  │
├──────────────┼──────┼──────┼───────────────┤
│ Mathématiques│  5   │ 14.5 │ Bien          │
│ Physique     │  4   │ 12.0 │ Assez bien    │
│ ...          │      │      │               │
├──────────────┴──────┴──────┴───────────────┤
│ Moyenne : 13.2/20   Mention : Assez Bien   │
│ Absences : 2 just. / 1 injust. / 0 retards │
├────────────────────────────────────────────┤
│ Appréciation conseil : "..."               │
│ Décision : Encouragements                  │
├────────────────────────────────────────────┤
│ Le Directeur,              Fait le ...     │
│ ________________                           │
└────────────────────────────────────────────┘
```

Palette : entête `#1a5276` (bleu sobre), lignes alternées gris clair, police système sans-serif.

### `backend/src/workers/generation-bulletins.worker.js`
Remplace le stub vide. Pattern identique à `calcul-moyennes.worker.js`.

```
init() → connectDB() + connectRedis()
traiterJob(job) :
  1. Récupérer liste inscriptions actives de la classe
  2. Pour chaque inscription → fetchDonneesBulletin()
  3. genererHTML() → puppeteer.generate() → uploadPDF()
  4. UPDATE bulletin_url en DB
Worker BullMQ concurrency: 1 (Puppeteer lourd)
```

---

## Fichiers modifiés

### `bulletins.routes.js`
- `POST /bulletins/generer` : ajouter `await enqueuerGenerationBulletins({ classe_id, periode_id, etablissement_id })` après le commit de transaction
- `GET /bulletins/:id/download` : message 404 distingue "PDF en cours de génération" (genere=true, url=null) vs "Bulletin non encore généré"

---

## Gestion d'erreurs

| Scénario | Comportement |
|----------|-------------|
| Puppeteer crash | Retry BullMQ x3 automatique |
| Upload R2 échoue | Retry BullMQ — PDF régénéré |
| Élève sans moyennes | Log warning + skip (pas bloquant) |
| Bulletin déjà généré | Idempotent — regénère et écrase `bulletin_url` |
| R2 non configuré (dev) | Fallback fichier local `/tmp/bulletins/` |

---

## Tests

### Unitaires (`bulletins.routes.test.js`)
- `POST /bulletins/generer` → vérifie que `enqueuerGenerationBulletins()` est appelé avec les bons paramètres
- `GET /bulletins/:id/download` → 404 avec message "en cours de génération" si `bulletin_url` null

### Worker (`tests/workers/generation-bulletins.worker.test.js`)
- Mock Puppeteer + mock R2 → vérifie que `bulletin_url` est mis à jour en DB
- Élève sans moyennes → skip propre, pas d'erreur

### Manuel (dev)
En mode dev sans variables R2, le PDF est écrit dans `/tmp/bulletins/` avec le chemin loggé — permet de valider le rendu sans compte cloud.

---

## Dépendances

| Package | Statut | Usage |
|---------|--------|-------|
| `puppeteer` | ✅ déjà installé | HTML → PDF |
| `@aws-sdk/client-s3` | ➕ à installer | Upload R2 |
| `bullmq` | ✅ déjà installé | Queue async |
| `knex` + `pg` | ✅ déjà installés | DB updates |
