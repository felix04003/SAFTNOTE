# SP1 — Affectations Enseignant → Classe + Matière

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre au directeur d'assigner un enseignant à une classe + matière, et de gérer la liste des affectations via le dashboard web.

**Architecture:** Trois nouveaux endpoints REST dans `identites.routes.js` (`GET /enseignants/:id/affectations`, `POST /affectations`, `DELETE /affectations/:id`). Les endpoints matières existants (`/configs/matieres`) sont réutilisés. Côté dashboard vanilla JS : un modal d'affectations déclenché depuis la page Enseignants, et une section matières dans Paramètres.

**Tech Stack:** Node.js/Express, Knex (getDB), Zod, HTML/CSS/JS vanilla, Jest + Supertest

---

## File Structure

| Action | Fichier | Rôle |
|--------|---------|------|
| Modify | `backend/src/domains/01-identites/identites.routes.js` | Ajouter GET/POST/DELETE affectations |
| Create | `backend/tests/domains/affectations.routes.test.js` | Tests des nouveaux endpoints |
| Modify | `dashboard/index.html` | Ajouter modals `m-affectations` et `m-matiere` |
| Modify | `dashboard/js/pages/enseignants.js` | Bouton Affecter + logique affectations |
| Modify | `dashboard/js/pages/parametres.js` | Section gestion des matières |

---

## Chunk 1 : Backend — Endpoints Affectations

### Task 1 : Tests pour les endpoints affectations

**Files:**
- Create: `backend/tests/domains/affectations.routes.test.js`

- [ ] **Step 1 : Écrire le fichier de tests**

```javascript
'use strict';

jest.mock('../../src/infrastructure/database/pool');
jest.mock('../../src/infrastructure/cache/redis', () => ({
  connectRedis: jest.fn(), getRedis: jest.fn(), getOrSet: jest.fn((k, fn) => fn()),
  invalidatePattern: jest.fn(), healthCheck: jest.fn(),
}));
jest.mock('../../src/infrastructure/queue/bullmq', () => ({
  QUEUES: {}, initQueues: jest.fn(), getQueue: jest.fn(),
  enqueuerNotification: jest.fn(), enqueuerCalculMoyennes: jest.fn(),
  enqueuerGenerationBulletins: jest.fn(),
}));
jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), http: jest.fn(), log: jest.fn(),
}));
jest.mock('../../src/middleware/auth.middleware', () => ({
  authentifier: (req, res, next) => {
    req.session = { ...require('../helpers/testApp').defaultSession };
    req.etablissement_id = req.session.etablissement_id;
    next();
  },
  autoriserRoles: () => (req, res, next) => next(),
}));
jest.mock('../../src/middleware/permission.middleware', () => ({
  exigerPermission: () => (req, res, next) => next(),
  isolerEtablissement: (req, res, next) => {
    if (req.session) req.etablissement_id = req.session.etablissement_id;
    next();
  },
}));

const request = require('supertest');
const { getDB } = require('../../src/infrastructure/database/pool');
const { mockQuery, createMockDB, IDS } = require('../helpers/mockKnex');
const { createTestApp } = require('../helpers/testApp');

const router = require('../../src/domains/01-identites/identites.routes');
const app = createTestApp(router);

const anneeCourante = { id: IDS.annee, libelle: '2025-2026' };
const affectationFixture = {
  id: IDS.affectation,
  enseignant_id: IDS.enseignant,
  classe_id: IDS.classe,
  matiere_id: IDS.matiere,
  annee_scolaire_id: IDS.annee,
  est_titulaire: true,
};

describe('Affectations Routes', () => {
  let db;

  beforeEach(() => {
    db = createMockDB();
    getDB.mockReturnValue(db);
  });

  // ── GET /enseignants/:id/affectations ──────────────────────────
  describe('GET /enseignants/:id/affectations', () => {
    test('retourne les affectations de l'année courante', async () => {
      db.mockReturnValueOnce(mockQuery(anneeCourante));               // annees_scolaires.first()
      db.mockReturnValueOnce(mockQuery([{                             // affectations join
        id: IDS.affectation, est_titulaire: true,
        matiere: 'Mathématiques', matiere_id: IDS.matiere,
        classe: 'A', classe_id: IDS.classe, niveau: '6ème',
      }]));

      const res = await request(app)
        .get(`/enseignants/${IDS.enseignant}/affectations`)
        .expect(200);

      expect(res.body.succes).toBe(true);
      expect(res.body.data.annee).toBe('2025-2026');
      expect(res.body.data.affectations).toHaveLength(1);
      expect(res.body.data.affectations[0].matiere).toBe('Mathématiques');
    });

    test('retourne 404 si aucune année courante', async () => {
      db.mockReturnValueOnce(mockQuery(undefined));  // annees_scolaires.first() → null

      const res = await request(app)
        .get(`/enseignants/${IDS.enseignant}/affectations`)
        .expect(404);

      expect(res.body.succes).toBe(false);
    });
  });

  // ── POST /affectations ─────────────────────────────────────────
  describe('POST /affectations', () => {
    test('crée une affectation valide', async () => {
      db.mockReturnValueOnce(mockQuery(anneeCourante));            // annees_scolaires.first()
      db.mockReturnValueOnce(mockQuery({ id: IDS.enseignant }));  // enseignant check
      db.mockReturnValueOnce(mockQuery({ id: IDS.classe }));      // classe check
      db.mockReturnValueOnce(mockQuery({ id: IDS.matiere }));     // matière check
      db.mockReturnValueOnce(mockQuery(undefined));                // doublon check → aucun
      db.mockReturnValueOnce(mockQuery([affectationFixture]));    // insert.returning()

      const res = await request(app)
        .post('/affectations')
        .send({
          enseignant_id: IDS.enseignant,
          classe_id: IDS.classe,
          matiere_id: IDS.matiere,
          est_titulaire: true,
        })
        .expect(201);

      expect(res.body.succes).toBe(true);
      expect(res.body.data.id).toBe(IDS.affectation);
    });

    test('retourne 409 si doublon classe+matière+année', async () => {
      db.mockReturnValueOnce(mockQuery(anneeCourante));
      db.mockReturnValueOnce(mockQuery({ id: IDS.enseignant }));
      db.mockReturnValueOnce(mockQuery({ id: IDS.classe }));
      db.mockReturnValueOnce(mockQuery({ id: IDS.matiere }));
      db.mockReturnValueOnce(mockQuery({ id: IDS.affectation })); // doublon trouvé

      const res = await request(app)
        .post('/affectations')
        .send({
          enseignant_id: IDS.enseignant,
          classe_id: IDS.classe,
          matiere_id: IDS.matiere,
        })
        .expect(409);

      expect(res.body.succes).toBe(false);
      expect(res.body.erreur).toMatch(/déjà assignée/);
    });

    test('retourne 422 si payload invalide', async () => {
      const res = await request(app)
        .post('/affectations')
        .send({ enseignant_id: 'pas-un-uuid' })
        .expect(422);

      expect(res.body.succes).toBe(false);
    });
  });

  // ── DELETE /affectations/:id ───────────────────────────────────
  describe('DELETE /affectations/:id', () => {
    test('supprime une affectation sans évaluations liées', async () => {
      db.mockReturnValueOnce(mockQuery({ id: IDS.affectation })); // affectation check
      db.mockReturnValueOnce(mockQuery(undefined));               // évaluations check → aucune
      db.mockReturnValueOnce(mockQuery(1));                       // delete

      const res = await request(app)
        .delete(`/affectations/${IDS.affectation}`)
        .expect(204);
    });

    test('retourne 409 si des évaluations existent', async () => {
      db.mockReturnValueOnce(mockQuery({ id: IDS.affectation }));
      db.mockReturnValueOnce(mockQuery({ id: IDS.evaluation })); // éval trouvée

      const res = await request(app)
        .delete(`/affectations/${IDS.affectation}`)
        .expect(409);

      expect(res.body.erreur).toMatch(/évaluations existent/);
    });

    test('retourne 404 si affectation introuvable', async () => {
      db.mockReturnValueOnce(mockQuery(undefined)); // not found

      const res = await request(app)
        .delete(`/affectations/${IDS.affectation}`)
        .expect(404);

      expect(res.body.succes).toBe(false);
    });
  });
});
```

- [ ] **Step 2 : Lancer les tests — vérifier qu'ils échouent**

```bash
cd "/Users/A.BEYE/SAFTH NOTE/ecolemanager/.claude/worktrees/crazy-tu/backend"
npx jest tests/domains/affectations.routes.test.js --no-coverage 2>&1 | tail -20
```
Résultat attendu : 7 failures (routes pas encore implémentées).

---

### Task 2 : Implémenter les endpoints dans identites.routes.js

**Files:**
- Modify: `backend/src/domains/01-identites/identites.routes.js` (ajouter avant `module.exports`)

- [ ] **Step 3 : Ajouter les 3 endpoints dans identites.routes.js**

Ajouter ce bloc **avant** `module.exports = router;` :

```javascript
// ── GET /enseignants/:enseignant_id/affectations ──────────────────
router.get('/enseignants/:enseignant_id/affectations', auth, isoler, perm('config.voir'), async (req, res, next) => {
  try {
    const db = getDB();
    const annee = await db('annees_scolaires')
      .where({ etablissement_id: req.etablissement_id, est_courante: true })
      .first('id', 'libelle');
    if (!annee) throw ApiError.nonTrouve('Aucune année scolaire courante');

    const affectations = await db('affectations_enseignants as ae')
      .join('matieres as m',  'm.id',  'ae.matiere_id')
      .join('classes as c',   'c.id',  'ae.classe_id')
      .join('niveaux as n',   'n.id',  'c.niveau_id')
      .where({
        'ae.enseignant_id':     req.params.enseignant_id,
        'ae.annee_scolaire_id': annee.id,
        'm.etablissement_id':   req.etablissement_id,
      })
      .select(
        'ae.id', 'ae.est_titulaire',
        'm.id as matiere_id', 'm.nom as matiere',
        'c.id as classe_id',  'c.nom as classe',
        'n.nom as niveau', 'n.ordre'
      )
      .orderBy(['n.ordre', 'm.nom']);

    return ok(res, { annee: annee.libelle, affectations });
  } catch (err) { next(err); }
});

// ── POST /affectations ────────────────────────────────────────────
router.post('/affectations', auth, isoler, perm('config.modifier'),
  valider(z.object({
    enseignant_id: z.string().uuid('enseignant_id doit être un UUID'),
    classe_id:     z.string().uuid('classe_id doit être un UUID'),
    matiere_id:    z.string().uuid('matiere_id doit être un UUID'),
    est_titulaire: z.boolean().default(true),
  })),
  async (req, res, next) => {
    try {
      const db = getDB();

      const annee = await db('annees_scolaires')
        .where({ etablissement_id: req.etablissement_id, est_courante: true })
        .first('id');
      if (!annee) throw ApiError.nonTrouve('Aucune année scolaire courante');

      // Vérifier appartenance à l'établissement
      const enseignant = await db('enseignants as e')
        .join('utilisateurs as u', 'u.id', 'e.utilisateur_id')
        .where({ 'e.id': req.body.enseignant_id, 'u.etablissement_id': req.etablissement_id })
        .first('e.id');
      if (!enseignant) throw ApiError.nonTrouve('Enseignant introuvable');

      const classe = await db('classes as c')
        .join('annees_scolaires as a', 'a.id', 'c.annee_scolaire_id')
        .where({ 'c.id': req.body.classe_id, 'a.etablissement_id': req.etablissement_id })
        .first('c.id');
      if (!classe) throw ApiError.nonTrouve('Classe introuvable');

      const matiere = await db('matieres')
        .where({ id: req.body.matiere_id, etablissement_id: req.etablissement_id })
        .first('id');
      if (!matiere) throw ApiError.nonTrouve('Matière introuvable');

      // Vérifier doublon
      const existant = await db('affectations_enseignants')
        .where({
          classe_id:          req.body.classe_id,
          matiere_id:         req.body.matiere_id,
          annee_scolaire_id:  annee.id,
        })
        .first('id');
      if (existant) throw ApiError.conflit('Cette matière est déjà assignée dans cette classe pour cette année');

      const [affectation] = await db('affectations_enseignants')
        .insert({
          id:                 uuid(),
          enseignant_id:      req.body.enseignant_id,
          classe_id:          req.body.classe_id,
          matiere_id:         req.body.matiere_id,
          annee_scolaire_id:  annee.id,
          est_titulaire:      req.body.est_titulaire,
        })
        .returning('*');

      return cree(res, affectation);
    } catch (err) { next(err); }
  }
);

// ── DELETE /affectations/:id ──────────────────────────────────────
router.delete('/affectations/:id', auth, isoler, perm('config.modifier'), async (req, res, next) => {
  try {
    const db = getDB();

    // Vérifier appartenance à l'établissement via la matière
    const affectation = await db('affectations_enseignants as ae')
      .join('matieres as m', 'm.id', 'ae.matiere_id')
      .where({ 'ae.id': req.params.id, 'm.etablissement_id': req.etablissement_id })
      .first('ae.id');
    if (!affectation) throw ApiError.nonTrouve('Affectation introuvable');

    // Bloquer si des évaluations sont liées
    const evalExist = await db('evaluations')
      .where({ affectation_id: req.params.id })
      .first('id');
    if (evalExist) throw ApiError.conflit('Impossible de supprimer : des évaluations existent pour cette affectation');

    await db('affectations_enseignants').where({ id: req.params.id }).del();
    return vide(res);
  } catch (err) { next(err); }
});
```

- [ ] **Step 4 : Lancer les tests — vérifier qu'ils passent**

```bash
cd "/Users/A.BEYE/SAFTH NOTE/ecolemanager/.claude/worktrees/crazy-tu/backend"
npx jest tests/domains/affectations.routes.test.js --no-coverage 2>&1 | tail -20
```
Résultat attendu : 7 tests PASS.

- [ ] **Step 5 : Lancer la suite complète pour vérifier aucune régression**

```bash
cd "/Users/A.BEYE/SAFTH NOTE/ecolemanager/.claude/worktrees/crazy-tu/backend"
npx jest --no-coverage 2>&1 | tail -10
```
Résultat attendu : 90/90 (83 existants + 7 nouveaux).

- [ ] **Step 6 : Commit backend**

```bash
cd "/Users/A.BEYE/SAFTH NOTE/ecolemanager/.claude/worktrees/crazy-tu"
git add backend/src/domains/01-identites/identites.routes.js \
        backend/tests/domains/affectations.routes.test.js
git commit -m "feat(backend): endpoints GET/POST/DELETE /affectations dans identites.routes"
```

---

## Chunk 2 : Dashboard — Modals + Page Enseignants + Paramètres

### Task 3 : Ajouter les modals dans index.html

**Files:**
- Modify: `dashboard/index.html` (après le dernier modal existant, avant `</body>`)

- [ ] **Step 7 : Repérer la fin de la section modals dans index.html**

Chercher la dernière ligne `</div>` du dernier modal (actuellement `m-detail-classe` ou similaire). Le nouveau contenu s'insère avant `<script` ou `</body>`.

- [ ] **Step 8 : Ajouter le modal m-affectations dans index.html**

Insérer ce bloc HTML avant la fermeture `</body>` (ou après le dernier `<!-- MODAL ... -->` existant) :

```html
<!-- MODAL AFFECTATIONS ENSEIGNANT -->
<div class="mo" id="m-affectations">
  <div class="modal" style="max-width:560px">
    <div class="mh">
      <span style="font-size:19px">📋</span>
      <span class="mt" id="m-aff-titre">Affectations</span>
      <button class="mc" onclick="closeModal('m-affectations')">✕</button>
    </div>
    <div class="mb">
      <!-- Formulaire ajout -->
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--g500);margin-bottom:10px">Ajouter une affectation</div>
      <div class="fr">
        <div class="fg">
          <label class="fl">Classe *</label>
          <select id="m-aff-classe" class="fs"><option value="">Chargement…</option></select>
        </div>
        <div class="fg">
          <label class="fl">Matière *</label>
          <select id="m-aff-matiere" class="fs"><option value="">Chargement…</option></select>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
        <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer">
          <input type="checkbox" id="m-aff-titulaire" checked> Titulaire de classe
        </label>
        <button id="btn-ajouter-aff" class="btn btn-p btn-sm" onclick="PageAffectations.ajouter()">+ Ajouter l'affectation</button>
      </div>
      <hr style="border:none;border-top:1px solid var(--g200);margin-bottom:14px">
      <!-- Liste affectations courantes -->
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--g500);margin-bottom:10px" id="m-aff-annee-label">Affectations actuelles</div>
      <div id="m-aff-liste" style="min-height:40px">
        <div style="color:var(--g400);font-size:13px;text-align:center;padding:16px">Chargement…</div>
      </div>
    </div>
    <div class="mf">
      <button class="btn btn-l" onclick="closeModal('m-affectations')">Fermer</button>
    </div>
  </div>
</div>

<!-- MODAL NOUVELLE MATIÈRE -->
<div class="mo" id="m-matiere">
  <div class="modal" style="max-width:460px">
    <div class="mh">
      <span style="font-size:19px">📚</span>
      <span class="mt">Nouvelle matière</span>
      <button class="mc" onclick="closeModal('m-matiere')">✕</button>
    </div>
    <div class="mb">
      <div class="fr">
        <div class="fg"><label class="fl">Nom *</label><input id="m-mat-nom" class="fi" placeholder="Mathématiques"></div>
        <div class="fg"><label class="fl">Nom court</label><input id="m-mat-court" class="fi" placeholder="Maths"></div>
      </div>
      <div class="fr">
        <div class="fg"><label class="fl">Code *</label><input id="m-mat-code" class="fi" placeholder="MATH" style="text-transform:uppercase"></div>
        <div class="fg">
          <label class="fl">Compte dans moyenne</label>
          <select id="m-mat-moyenne" class="fs"><option value="true">Oui</option><option value="false">Non</option></select>
        </div>
      </div>
      <div class="fg">
        <label class="fl">Discipline parente <span style="color:var(--g400)">(optionnel)</span></label>
        <select id="m-mat-discipline" class="fs">
          <option value="">— Aucune discipline —</option>
        </select>
      </div>
    </div>
    <div class="mf">
      <button class="btn btn-l" onclick="closeModal('m-matiere')">Annuler</button>
      <button id="btn-creer-matiere" class="btn btn-p" onclick="PageParametres.creerMatiere()">Créer la matière</button>
    </div>
  </div>
</div>
```

- [ ] **Step 9 : Commit HTML**

```bash
cd "/Users/A.BEYE/SAFTH NOTE/ecolemanager/.claude/worktrees/crazy-tu"
git add dashboard/index.html
git commit -m "feat(dashboard): ajout modals m-affectations et m-matiere dans index.html"
```

---

### Task 4 : Mettre à jour enseignants.js

**Files:**
- Modify: `dashboard/js/pages/enseignants.js`

- [ ] **Step 10 : Remplacer le contenu complet de enseignants.js**

```javascript
'use strict';

/**
 * Page Enseignants — liste, création, gestion des affectations.
 */
var PageEnseignants = {
  data: [],

  async charger() {
    try {
      var res = await Api.get('/enseignants');
      this.data = res.data;
      this.renderTable(res.data);
      return true;
    } catch (e) {
      console.warn('PageEnseignants: fallback mock —', e.message);
      return false;
    }
  },

  async ajouter() {
    var nom        = document.getElementById('m-ens-nom')?.value?.trim();
    var prenom     = document.getElementById('m-ens-prenom')?.value?.trim();
    var telephone  = document.getElementById('m-ens-tel')?.value?.trim();
    var email      = document.getElementById('m-ens-email')?.value?.trim();
    var specialite = document.getElementById('m-ens-specialite')?.value?.trim();
    var contrat    = document.getElementById('m-ens-contrat')?.value;
    var mdp        = document.getElementById('m-ens-mdp')?.value?.trim();

    if (!nom || !prenom) return toast('Nom et prénom obligatoires', 'w');
    if (!telephone)      return toast('Numéro de téléphone obligatoire', 'w');

    var payload = {
      nom: nom,
      prenom: prenom,
      telephone: telephone.replace(/\s/g, ''),
      email: email || undefined,
      specialite: specialite || undefined,
      type_contrat: contrat || 'titulaire',
      mot_de_passe: mdp || undefined,
    };

    var btn = document.getElementById('btn-ajouter-ens');
    if (btn) { btn.disabled = true; btn.textContent = 'Création…'; }

    try {
      var res = await Api.post('/enseignants', payload);
      closeModal('m-enseignant');
      var mdpInfo = (res.data && res.data.message) || ('Mot de passe provisoire : ' + (mdp || telephone));
      toast('Enseignant créé ✓ — ' + mdpInfo, 's');
      await this.charger();
    } catch (e) {
      toast('Erreur : ' + (e.message || 'Création échouée'), 'd');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Créer le compte'; }
    }
  },

  renderTable: function(enseignants) {
    var tbody = document.getElementById('tb-ens');
    if (!tbody) return;

    if (!enseignants || !enseignants.length) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--g400);padding:30px">Aucun enseignant trouvé</td></tr>';
      return;
    }

    tbody.innerHTML = enseignants.map(function(e) {
      var nom = (e.prenom || '') + ' ' + (e.nom || '');
      return '<tr>' +
        '<td class="nc" style="display:flex;align-items:center;gap:9px"><div class="av" style="background:var(--bleu)">' + init2(nom) + '</div>' + nom + '</td>' +
        '<td><span class="badge bo">' + (e.specialite || '—') + '</span></td>' +
        '<td style="font-size:12px;color:var(--g500)">' + (e.telephone || '—') + '</td>' +
        '<td style="font-size:12px;color:var(--g500)">' + (e.email || '—') + '</td>' +
        '<td><span class="badge bn">' + (e.type_contrat || 'titulaire') + '</span></td>' +
        '<td><span class="badge bs">Actif</span></td>' +
        '<td style="display:flex;gap:6px">' +
          '<button class="btn btn-l btn-sm" onclick="toast(\'Fiche à venir\')">Voir</button>' +
          '<button class="btn btn-p btn-sm" onclick="PageAffectations.ouvrir(\'' + e.id + '\',\'' + nom.replace(/'/g, '') + '\')">📋 Affecter</button>' +
        '</td>' +
      '</tr>';
    }).join('');
  },

  init: function() { this.charger(); }
};

PAGE_HOOKS.enseignants = function() { PageEnseignants.init(); };

// ─────────────────────────────────────────────────────────────────
// PageAffectations — géré depuis la page Enseignants
// ─────────────────────────────────────────────────────────────────
var PageAffectations = {
  enseignantId:  null,
  enseignantNom: null,

  async ouvrir(id, nom) {
    this.enseignantId  = id;
    this.enseignantNom = nom;

    var titre = document.getElementById('m-aff-titre');
    if (titre) titre.textContent = 'Affectations — ' + nom;

    openModal('m-affectations');
    await Promise.all([this.chargerClasses(), this.chargerMatieres(), this.chargerAffectations()]);
  },

  async chargerClasses() {
    var sel = document.getElementById('m-aff-classe');
    if (!sel) return;
    try {
      var res = await Api.get('/classes');
      var classes = res.data || [];
      if (!classes.length) {
        sel.innerHTML = '<option value="">Aucune classe</option>';
        return;
      }
      sel.innerHTML = '<option value="">— Choisir —</option>' +
        classes.map(function(c) {
          return '<option value="' + c.id + '">' + (c.niveau_nom || c.niveau || '') + ' ' + c.nom + '</option>';
        }).join('');
    } catch (e) {
      sel.innerHTML = '<option value="">Erreur chargement classes</option>';
    }
  },

  async chargerMatieres() {
    var sel = document.getElementById('m-aff-matiere');
    if (!sel) return;
    try {
      var res = await Api.get('/configs/matieres', { actif_seulement: 'true' });
      var matieres = res.data || [];
      if (!matieres.length) {
        sel.innerHTML = '<option value="">Aucune matière — créez-en dans Paramètres</option>';
        return;
      }
      sel.innerHTML = '<option value="">— Choisir —</option>' +
        matieres.map(function(m) {
          return '<option value="' + m.id + '">' + m.nom + '</option>';
        }).join('');
    } catch (e) {
      sel.innerHTML = '<option value="">Erreur chargement matières</option>';
    }
  },

  async chargerAffectations() {
    var liste = document.getElementById('m-aff-liste');
    var label = document.getElementById('m-aff-annee-label');
    if (!liste) return;

    liste.innerHTML = '<div style="color:var(--g400);font-size:13px;text-align:center;padding:16px">Chargement…</div>';

    try {
      var res = await Api.get('/enseignants/' + this.enseignantId + '/affectations');
      var data = res.data;
      if (label) label.textContent = 'Affectations actuelles (' + (data.annee || '') + ')';

      var aff = data.affectations || [];
      if (!aff.length) {
        liste.innerHTML = '<div style="color:var(--g400);font-size:13px;text-align:center;padding:16px">(Aucune affectation pour le moment)</div>';
        return;
      }

      var self = this;
      liste.innerHTML = aff.map(function(a) {
        return '<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--g100)">' +
          '<span style="font-size:13px">• <strong>' + a.matiere + '</strong> · ' + (a.niveau || '') + ' ' + a.classe + (a.est_titulaire ? ' <span class="badge bs" style="font-size:10px">Titulaire</span>' : '') + '</span>' +
          '<button class="btn btn-d btn-sm" onclick="PageAffectations.supprimer(\'' + a.id + '\')">🗑️</button>' +
        '</div>';
      }).join('');
    } catch (e) {
      liste.innerHTML = '<div style="color:var(--rouge);font-size:13px;text-align:center;padding:16px">Impossible de charger les affectations</div>';
    }
  },

  async ajouter() {
    var classeId  = document.getElementById('m-aff-classe')?.value;
    var matiereId = document.getElementById('m-aff-matiere')?.value;
    var titulaire = document.getElementById('m-aff-titulaire')?.checked;

    if (!classeId)  return toast('Veuillez sélectionner une classe', 'w');
    if (!matiereId) return toast('Veuillez sélectionner une matière', 'w');

    var btn = document.getElementById('btn-ajouter-aff');
    if (btn) { btn.disabled = true; btn.textContent = 'Ajout…'; }

    try {
      await Api.post('/affectations', {
        enseignant_id: this.enseignantId,
        classe_id:     classeId,
        matiere_id:    matiereId,
        est_titulaire: !!titulaire,
      });
      toast('Affectation ajoutée ✓', 's');
      // Réinitialiser les selects et recharger la liste
      document.getElementById('m-aff-classe').value = '';
      document.getElementById('m-aff-matiere').value = '';
      await this.chargerAffectations();
    } catch (e) {
      toast('Erreur : ' + (e.message || 'Ajout échoué'), 'd');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '+ Ajouter l\'affectation'; }
    }
  },

  async supprimer(affectationId) {
    if (!confirm('Supprimer cette affectation ?')) return;
    try {
      await Api.del('/affectations/' + affectationId);
      toast('Affectation supprimée', 's');
      await this.chargerAffectations();
    } catch (e) {
      toast('Erreur : ' + (e.message || 'Suppression échouée'), 'd');
    }
  },
};
```

- [ ] **Step 11 : Vérifier visuellement dans le navigateur**

1. Ouvrir `http://localhost:3003`
2. Se connecter en tant que directeur
3. Aller sur la page Enseignants → chaque ligne doit afficher le bouton `📋 Affecter`
4. Cliquer `📋 Affecter` → le modal s'ouvre avec le nom de l'enseignant dans le titre
5. Les selects Classe et Matière se chargent
6. Ajouter une affectation → toast de succès, liste mise à jour
7. Supprimer une affectation → toast de succès

- [ ] **Step 12 : Commit enseignants.js**

```bash
cd "/Users/A.BEYE/SAFTH NOTE/ecolemanager/.claude/worktrees/crazy-tu"
git add dashboard/js/pages/enseignants.js
git commit -m "feat(dashboard): bouton Affecter + modal PageAffectations dans enseignants.js"
```

---

### Task 5 : Section matières dans parametres.js

**Files:**
- Modify: `dashboard/js/pages/parametres.js`

> **Note de décision** : Le spec désigne de nouveaux endpoints `/matieres` dans `identites.routes.js`, mais `GET /configs/matieres` et `POST /configs/matieres` existent déjà dans `configs.routes.js` avec exactement le même comportement. On réutilise l'existant pour éviter la duplication — principe DRY.

- [ ] **Step 13 : Remplacer le contenu complet de parametres.js**

```javascript
'use strict';

/**
 * Page Paramètres — infos établissement + gestion des matières.
 */
var PageParametres = {
  async charger() {
    try {
      var res = await Api.get('/etablissement');
      this.remplirFormulaire(res.data);
    } catch (e) {
      console.warn('PageParametres: fallback statique —', e.message);
    }
    await this.chargerMatieres();
  },

  remplirFormulaire: function(etab) {
    var set = function(id, val) { var el = document.getElementById(id); if (el && val) el.value = val; };
    set('param-nom',   etab.nom);
    set('param-code',  etab.code_officiel);
    set('param-ville', etab.ville);
    set('param-tel',   etab.telephone);
    set('param-email', etab.email);
  },

  sauvegarder: async function() {
    var get = function(id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; };
    var payload = {};
    var nom   = get('param-nom');
    var ville = get('param-ville');
    var tel   = get('param-tel');
    var email = get('param-email');

    if (nom)   payload.nom   = nom;
    if (ville) payload.ville = ville;
    if (tel)   payload.telephone = tel;
    if (email) payload.email = email;

    if (!Object.keys(payload).length) return toast('Aucune modification détectée', 'w');

    var btn = document.getElementById('btn-param-save');
    if (btn) { btn.disabled = true; btn.textContent = 'Enregistrement…'; }

    try {
      await Api.put('/etablissement', payload);
      toast('Paramètres enregistrés ✓', 's');
    } catch (e) {
      toast('Erreur : ' + (e.message || 'Sauvegarde échouée'), 'd');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '💾 Enregistrer'; }
    }
  },

  // ── Matières ────────────────────────────────────────────────────

  async chargerMatieres() {
    var liste = document.getElementById('param-matieres-liste');
    if (!liste) return;
    liste.innerHTML = '<div style="color:var(--g400);font-size:13px;padding:10px">Chargement…</div>';
    try {
      var res = await Api.get('/configs/matieres');
      var matieres = res.data || [];

      // Extraire les disciplines uniques pour le select du modal m-matiere
      var discSel = document.getElementById('m-mat-discipline');
      if (discSel) {
        var disciplinesVues = {};
        matieres.forEach(function(m) {
          if (m.discipline_id && !disciplinesVues[m.discipline_id]) {
            disciplinesVues[m.discipline_id] = m.discipline;
          }
        });
        var discOptions = Object.keys(disciplinesVues).map(function(id) {
          return '<option value="' + id + '">' + disciplinesVues[id] + '</option>';
        });
        discSel.innerHTML = '<option value="">— Aucune discipline —</option>' + discOptions.join('');
      }

      if (!matieres.length) {
        liste.innerHTML = '<div style="color:var(--g400);font-size:13px;padding:10px">Aucune matière — cliquez sur « + Nouvelle matière » pour commencer.</div>';
        return;
      }
      liste.innerHTML = matieres.map(function(m) {
        return '<div style="display:flex;align-items:center;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--g100)">' +
          '<span style="font-size:13px"><strong>' + m.nom + '</strong>' +
          (m.nom_court ? ' <span style="color:var(--g400);font-size:11px">(' + m.nom_court + ')</span>' : '') +
          ' <span class="badge bo" style="font-size:10px">' + m.code + '</span>' +
          (m.discipline ? ' · ' + m.discipline : '') +
          (!m.actif ? ' <span class="badge bd" style="font-size:10px">Inactif</span>' : '') +
          '</span>' +
        '</div>';
      }).join('');
    } catch (e) {
      liste.innerHTML = '<div style="color:var(--rouge);font-size:13px;padding:10px">Impossible de charger les matières</div>';
    }
  },

  async creerMatiere() {
    var nom          = document.getElementById('m-mat-nom')?.value?.trim();
    var court        = document.getElementById('m-mat-court')?.value?.trim();
    var code         = document.getElementById('m-mat-code')?.value?.trim().toUpperCase();
    var moyenne      = document.getElementById('m-mat-moyenne')?.value === 'true';
    var disciplineId = document.getElementById('m-mat-discipline')?.value || undefined;

    if (!nom)  return toast('Le nom est obligatoire', 'w');
    if (!code) return toast('Le code est obligatoire', 'w');

    var btn = document.getElementById('btn-creer-matiere');
    if (btn) { btn.disabled = true; btn.textContent = 'Création…'; }

    try {
      await Api.post('/configs/matieres', {
        nom: nom,
        nom_court: court || undefined,
        code: code,
        compte_dans_moyenne: moyenne,
        discipline_id: disciplineId || undefined,
      });
      closeModal('m-matiere');
      toast('Matière « ' + nom + ' » créée ✓', 's');
      // Réinitialiser le formulaire
      ['m-mat-nom', 'm-mat-court', 'm-mat-code'].forEach(function(id) {
        var el = document.getElementById(id); if (el) el.value = '';
      });
      await this.chargerMatieres();
    } catch (e) {
      toast('Erreur : ' + (e.message || 'Création échouée'), 'd');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Créer la matière'; }
    }
  },

  init: function() { this.charger(); }
};

PAGE_HOOKS.parametres = function() { PageParametres.init(); };
```

- [ ] **Step 14 : Ajouter la section matières dans la page Paramètres dans index.html**

Dans `index.html`, trouver la section `id="p-parametres"` et ajouter ce bloc **juste avant** la div fermante `</div>` de la page (après la carte Sécurité) :

```html
          <!-- Matières -->
          <div class="carte" style="margin-top:18px">
            <div class="ch">
              <span>📚</span>
              <span class="ct">Matières</span>
              <button class="btn btn-p btn-sm" onclick="openModal('m-matiere')" style="margin-left:auto">+ Nouvelle matière</button>
            </div>
            <div class="cb">
              <div id="param-matieres-liste" style="min-height:40px">
                <div style="color:var(--g400);font-size:13px;padding:10px">Chargement…</div>
              </div>
            </div>
          </div>
```

- [ ] **Step 15 : Vérifier visuellement**

1. Aller sur la page Paramètres → la section Matières doit apparaître en bas
2. Si des matières existent → elles s'affichent
3. Cliquer `+ Nouvelle matière` → modal s'ouvre
4. Remplir nom + code → créer → toast de succès + liste rafraîchie
5. Si la liste était vide : message d'aide s'affiche

- [ ] **Step 16 : Commit final**

```bash
cd "/Users/A.BEYE/SAFTH NOTE/ecolemanager/.claude/worktrees/crazy-tu"
git add dashboard/js/pages/parametres.js dashboard/index.html
git commit -m "feat(dashboard): section matières dans Paramètres + modal m-matiere"
```

---

## Récapitulatif des commits attendus

```
feat(backend): endpoints GET/POST/DELETE /affectations dans identites.routes
feat(dashboard): ajout modals m-affectations et m-matiere dans index.html
feat(dashboard): bouton Affecter + modal PageAffectations dans enseignants.js
feat(dashboard): section matières dans Paramètres + modal m-matiere
```

## Vérification finale

```bash
# Tests backend
cd "/Users/A.BEYE/SAFTH NOTE/ecolemanager/.claude/worktrees/crazy-tu/backend"
npx jest --no-coverage 2>&1 | grep -E "Tests:|passed|failed"
# Attendu : 90 passed

# Dashboard : ouvrir le navigateur
# http://localhost:3003 → Enseignants → bouton Affecter → modal fonctionne
# http://localhost:3003 → Paramètres → section Matières → créer une matière
```
