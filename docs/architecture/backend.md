# Architecture — Backend

## Structure des domaines

```
backend/src/
  app.js                          ← Express app, montage des routers
  domains/
    setup/                        ← Inscription établissement (public)
    01-identites/
      identites.routes.js         ← établissements, classes, années, affectations
    02-acteurs/
      auth/auth.routes.js         ← connexion, OTP, reset mdp, déconnexion
      eleves/eleves.routes.js     ← CRUD élèves
      parents/parents.routes.js   ← portail parents (enfants, notes, absences, bulletins)
      enseignants/
        enseignants.routes.js     ← profil, classes, EDT, appels
    03-pedagogie/
      pedagogie.routes.js         ← matières, évaluations, notes, bulletins, moyennes
    04-vie-scolaire/
      vie-scolaire.routes.js      ← appels, présences, discipline, EDT, événements
    05-securite/
      securite.routes.js          ← logs d'accès, gestion sessions
    sync.routes.js                ← sync mobile (delta sync)
  middleware/
    auth.middleware.js            ← `auth` : vérifie JWT, charge session
    permission.middleware.js      ← `perm('code')` : vérifie permission rôle
    validate.middleware.js        ← `valider(zodSchema)` : validation body
    error.middleware.js           ← handler global erreurs
    notFound.middleware.js        ← 404
  infrastructure/
    database/pool.js              ← `getDB()` → instance Knex
    cache/redis.js                ← `getRedis()`, `invalidatePattern(key*)`
    notifications/sms.service.js  ← `envoyerOTP(tel, code, nomEtab)`
    monitoring/                   ← logs structurés Winston
  utils/
    ApiError.js                   ← classes d'erreurs métier (nonTrouve, nonAutorise, etc.)
    logger.js                     ← Winston logger
```

## Middlewares — Usage

```javascript
// Ordre standard sur un endpoint protégé
router.get('/route', auth, isoler, perm('domaine.action'), valider(schema), handler);

// auth      → vérifie JWT cookie, charge req.session.utilisateur_id
// isoler    → injecte req.etablissement_id depuis la session
// perm()    → vérifie que le rôle possède la permission
// valider() → valide req.body contre un schéma Zod, renvoie 422 si invalide
```

## Pattern de réponse

```javascript
const { ok } = require('../../utils/response');   // { succes: true, data: ... }
const ApiError = require('../../utils/ApiError');

// Succès
return ok(res, donnees);

// Erreurs métier
throw ApiError.nonTrouve('Message');       // 404
throw ApiError.nonAutorise('Message');     // 403
throw ApiError.demandeInvalide('Message'); // 400
// → capturées par error.middleware.js → { succes: false, erreur, code }
```

## Pattern getEnseignantConnecte

```javascript
// Récupère l'enseignant depuis utilisateur_id en session
// Utilisé dans tous les endpoints /enseignants/moi/*
const enseignant = await getEnseignantConnecte(db, req.session.utilisateur_id);
// → { id, prenom, nom, ... } ou ApiError.nonTrouve si absent
```

## Cache Redis

```javascript
const { invalidatePattern } = require('../../../infrastructure/cache/redis');

// Invalider toutes les clés d'un enseignant après modification
await invalidatePattern('edt_ens:' + enseignant.id + '*');

// Patterns de cache par domaine
// edt_ens:{enseignant_id}:{semaine}  ← EDT enseignant par semaine
```

## Validation Zod

```javascript
const { z } = require('zod');
const { valider } = require('../../middleware/validate.middleware');

const schema = z.object({
  nom: z.string().min(2).max(100),
  salle: z.string().max(50).nullable().optional(),
});

router.post('/route', auth, isoler, valider(schema), handler);
```

## Conventions SQL (Knex)

```javascript
const db = getDB();

// Toujours filtrer par etablissement_id
const eleves = await db('eleves').where({ etablissement_id: req.etablissement_id });

// Ownership check enseignant → créneau (via join, pas de colonne directe)
const creneau = await db('emplois_du_temps as edt')
  .join('affectations_enseignants as ae', 'ae.id', 'edt.affectation_id')
  .where({ 'edt.id': id, 'ae.enseignant_id': enseignant.id })
  .first('edt.id');
```
