# EDT Enseignant Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Améliorer la page EDT enseignant avec navigation par semaine, couleurs DB, et un drawer latéral permettant de faire l'appel, voir l'historique, accéder aux notes et modifier la salle.

**Architecture:** 4 fichiers modifiés. Backend : (1) ajouter `m.couleur_affichage` au GET EDT, (2) nouveau endpoint GET /appels/cours, (3) nouveau endpoint PUT /enseignants/moi/edt/:id/salle. Frontend : réécriture complète de `ens-edt.js` en ES5 pur (3 objets : PageEnsEdt, EdtDrawer, EdtAppel) + ajout du drawer dans `enseignant.html`.

**Tech Stack:** Node.js/Express, Knex.js, PostgreSQL, vanilla JS ES5, Jest/supertest pour les tests backend.

**Conventions importantes :**
- Backend : tous les helpers (`getDB`, `authentifier`, `ok`, `ApiError`, etc.) sont déjà importés dans les fichiers existants — copier le pattern exact du fichier.
- Frontend : **jamais** de `async method()` shorthand. Toujours `key: async function()`. Jamais `this.xxx` — toujours `PageEnsEdt.xxx`, `EdtDrawer.xxx`, `EdtAppel.xxx`.
- Tests backend : utiliser `supertest` + helpers existants `getTestDB`, `creerSession`, `seedTestData` (voir `tests/integration/appels.integration.test.js` comme modèle).
- `POST /appels` retourne `{ appel_id: uuid, nb_eleves: n }` — utiliser `res.data.appel_id`, pas `res.data.id`.

---

## Chunk 1 : Backend — couleur + GET /appels/cours + PUT salle

### Task 1 : Ajouter `m.couleur_affichage` à GET /enseignants/moi/edt

**Files:**
- Modify: `backend/src/domains/02-acteurs/enseignants/enseignants.routes.js:218-233`

- [ ] **Step 1 : Localiser le SELECT**

  Le `.select(...)` du GET `/enseignants/moi/edt` se trouve aux lignes ~218–233. Il contient `'edt.id as creneau_id'`, `'m.nom as matiere'`, etc. La colonne `m.couleur_affichage` existe sur `matieres` (alias `m` déjà jointé ligne ~210).

- [ ] **Step 2 : Ajouter la colonne**

  ```javascript
  // Avant (ligne ~230) :
  'm.code as matiere_code',
  'edt.salle',

  // Après :
  'm.code as matiere_code',
  'm.couleur_affichage',
  'edt.salle',
  ```

- [ ] **Step 3 : Lancer les tests existants**

  ```bash
  cd backend
  npx jest tests/integration/enseignants.integration.test.js --no-coverage 2>&1 | tail -20
  ```
  Expected : `PASS`.

- [ ] **Step 4 : Commit**

  ```bash
  git -C .. add backend/src/domains/02-acteurs/enseignants/enseignants.routes.js
  git -C .. commit -m "feat: add couleur_affichage to GET /enseignants/moi/edt"
  ```

---

### Task 2 : Ajouter GET /appels/cours

**Files:**
- Modify: `backend/src/domains/04-vie-scolaire/appels/appels.routes.js`
- Test: `backend/tests/integration/appels.integration.test.js`

- [ ] **Step 1 : Écrire le test qui échoue**

  Dans `tests/integration/appels.integration.test.js`, ajouter à la fin du fichier (avant `module.exports` s'il existe) :

  ```javascript
  // ── GET /appels/cours ───────────────────────────────────────────

  describe('GET /api/v1/appels/cours', () => {
    it('devrait retourner null + élèves si aucun appel existant', async () => {
      if (!edtId) return;

      const res = await request
        .get('/api/v1/appels/cours')
        .query({ emploi_du_temps_id: edtId, date_cours: '2025-01-15' })
        .set('Authorization', `Bearer ${tokenEns}`)
        .expect(200);

      expect(res.body.succes).toBe(true);
      expect(res.body.data.appel_id).toBeNull();
      expect(res.body.data.statut).toBeNull();
      expect(Array.isArray(res.body.data.eleves)).toBe(true);
    });

    it('devrait retourner appel_id + statut si un appel existe', async () => {
      if (!edtId) return;

      await request
        .post('/api/v1/appels')
        .set('Authorization', `Bearer ${tokenEns}`)
        .send({ emploi_du_temps_id: edtId, date_cours: '2025-02-10' });

      const res = await request
        .get('/api/v1/appels/cours')
        .query({ emploi_du_temps_id: edtId, date_cours: '2025-02-10' })
        .set('Authorization', `Bearer ${tokenEns}`)
        .expect(200);

      expect(res.body.data.appel_id).not.toBeNull();
      expect(res.body.data.statut).toBe('ouvert');
    });

    it('devrait refuser si emploi_du_temps_id n\'appartient pas à l\'enseignant', async () => {
      await request
        .get('/api/v1/appels/cours')
        .query({ emploi_du_temps_id: '00000000-0000-0000-0000-000000000000', date_cours: '2025-01-15' })
        .set('Authorization', `Bearer ${tokenEns}`)
        .expect(403);
    });

    it('devrait refuser sans authentification', async () => {
      await request
        .get('/api/v1/appels/cours')
        .query({ emploi_du_temps_id: edtId || '00000000-0000-0000-0000-000000000000', date_cours: '2025-01-15' })
        .expect(401);
    });
  });
  ```

- [ ] **Step 2 : Vérifier que le test échoue (route inexistante)**

  ```bash
  cd backend
  npx jest tests/integration/appels.integration.test.js --no-coverage -t "GET /api/v1/appels/cours" 2>&1 | tail -20
  ```
  Expected : `FAIL` — 404 ou erreur de route.

- [ ] **Step 3 : Implémenter GET /appels/cours**

  Ajouter **avant** `// ── PUT /appels/:appel_id/presences` dans `appels.routes.js` :

  ```javascript
  // ── GET /appels/cours — État d'un cours pour le drawer EDT ──────
  // ?emploi_du_temps_id=<uuid>&date_cours=YYYY-MM-DD
  router.get('/appels/cours', auth, isoler, perm('absences.faire_appel'), async (req, res, next) => {
    const db = getDB();
    try {
      const { emploi_du_temps_id, date_cours } = req.query;

      if (!emploi_du_temps_id || !date_cours) {
        throw ApiError.validationEchouee('emploi_du_temps_id et date_cours requis');
      }

      // Ownership check : le créneau doit appartenir à une affectation de l'enseignant
      // dans l'établissement courant (scoping via annees_scolaires)
      const creneauEns = await db('emplois_du_temps as edt')
        .join('affectations_enseignants as ae', 'ae.id',  'edt.affectation_id')
        .join('classes as c',                  'c.id',   'ae.classe_id')
        .join('annees_scolaires as a',          'a.id',   'c.annee_scolaire_id')
        .join('enseignants as ens',             'ens.id', 'ae.enseignant_id')
        .where({
          'edt.id':             emploi_du_temps_id,
          'ens.utilisateur_id': req.session.utilisateur_id,
          'a.etablissement_id': req.etablissement_id,
        })
        .first('edt.id', 'ae.classe_id', 'a.id as annee_id');

      if (!creneauEns) throw ApiError.interdit('Ce créneau ne vous appartient pas');

      // Chercher l'appel existant
      const appel = await db('appels')
        .where({ emploi_du_temps_id, date_cours })
        .first('id', 'statut');

      // Récupérer les élèves inscrits dans la classe
      const inscriptions = await db('inscriptions as i')
        .join('eleves as el',       'el.id', 'i.eleve_id')
        .join('utilisateurs as u',  'u.id',  'el.utilisateur_id')
        .where({
          'i.classe_id':         creneauEns.classe_id,
          'i.annee_scolaire_id': creneauEns.annee_id,
          'i.statut':            'actif',
        })
        .orderBy(['u.nom', 'u.prenom'])
        .select('i.id as inscription_id', 'u.nom', 'u.prenom');

      // Si un appel existe, récupérer les statuts de présence
      const presencesMap = {};
      if (appel) {
        const presences = await db('presences')
          .where({ appel_id: appel.id })
          .select('inscription_id', 'statut', 'minutes_retard');
        presences.forEach(function(p) {
          presencesMap[p.inscription_id] = { statut: p.statut, minutes_retard: p.minutes_retard || 0 };
        });
      }

      const eleves = inscriptions.map(function(i) {
        const p = presencesMap[i.inscription_id] || { statut: 'non_saisi', minutes_retard: 0 };
        return {
          inscription_id: i.inscription_id,
          nom:            i.nom,
          prenom:         i.prenom,
          statut:         p.statut,
          minutes_retard: p.minutes_retard,
        };
      });

      return ok(res, {
        appel_id: appel ? appel.id     : null,
        statut:   appel ? appel.statut : null,
        eleves,
      });

    } catch (err) { next(err); }
  });
  ```

- [ ] **Step 4 : Lancer le test**

  ```bash
  cd backend
  npx jest tests/integration/appels.integration.test.js --no-coverage 2>&1 | tail -20
  ```
  Expected : `PASS`.

- [ ] **Step 5 : Commit**

  ```bash
  git -C .. add backend/src/domains/04-vie-scolaire/appels/appels.routes.js \
               backend/tests/integration/appels.integration.test.js
  git -C .. commit -m "feat: add GET /appels/cours for EDT drawer"
  ```

---

### Task 3 : Ajouter PUT /enseignants/moi/edt/:creneau_id/salle

**Files:**
- Modify: `backend/src/domains/02-acteurs/enseignants/enseignants.routes.js`
- Test: `backend/tests/integration/enseignants.integration.test.js`

- [ ] **Step 1 : Ajouter l'import `invalidatePattern` en haut du fichier**

  Dans `enseignants.routes.js`, localiser les imports en haut. Si `invalidatePattern` n'est pas déjà importé, ajouter la ligne suivante avec les autres imports infrastructure :

  ```javascript
  const { invalidatePattern } = require('../../../infrastructure/cache/redis');
  ```

- [ ] **Step 2 : Écrire le test qui échoue**

  Dans `tests/integration/enseignants.integration.test.js`, localiser la fin du fichier et ajouter avant `afterAll` :

  ```javascript
  describe('PUT /api/v1/enseignants/moi/edt/:creneau_id/salle', () => {
    let creneauId;

    beforeAll(async () => {
      const db = getTestDB();
      const creneau = await db('emplois_du_temps as edt')
        .join('affectations_enseignants as ae', 'ae.id', 'edt.affectation_id')
        .where({ 'ae.enseignant_id': seed.enseignant.id })
        .first('edt.id');
      creneauId = creneau?.id;
    });

    it('devrait mettre à jour la salle', async () => {
      if (!creneauId) return;

      const res = await request
        .put(`/api/v1/enseignants/moi/edt/${creneauId}/salle`)
        .set('Authorization', `Bearer ${tokenEns}`)
        .send({ salle: 'Labo B2' })
        .expect(200);

      expect(res.body.succes).toBe(true);
      expect(res.body.data.salle).toBe('Labo B2');
    });

    it('devrait retourner 404 si le créneau n\'appartient pas à l\'enseignant', async () => {
      await request
        .put('/api/v1/enseignants/moi/edt/00000000-0000-0000-0000-000000000000/salle')
        .set('Authorization', `Bearer ${tokenEns}`)
        .send({ salle: 'Salle X' })
        .expect(404);
    });

    it('devrait refuser une salle trop longue (> 50 car.)', async () => {
      if (!creneauId) return;

      await request
        .put(`/api/v1/enseignants/moi/edt/${creneauId}/salle`)
        .set('Authorization', `Bearer ${tokenEns}`)
        .send({ salle: 'A'.repeat(51) })
        .expect(422);
    });
  });
  ```

- [ ] **Step 3 : Lancer le test pour vérifier qu'il échoue**

  ```bash
  cd backend
  npx jest tests/integration/enseignants.integration.test.js --no-coverage -t "PUT /api/v1/enseignants/moi/edt" 2>&1 | tail -20
  ```
  Expected : `FAIL` — 404 ou route inconnue.

- [ ] **Step 4 : Implémenter PUT /enseignants/moi/edt/:creneau_id/salle**

  Dans `enseignants.routes.js`, ajouter **après** le handler `GET /enseignants/moi/edt` (après son `} catch (err) { next(err); }`) :

  ```javascript
  // ═════════════════════════════════════════════════════════════════
  // PUT /enseignants/moi/edt/:creneau_id/salle
  // Mise à jour de la salle d'un créneau (enseignant propriétaire)
  // Permission : edt.modifier_ponctuel
  // ═════════════════════════════════════════════════════════════════
  router.put('/enseignants/moi/edt/:creneau_id/salle', auth, isoler, perm('edt.modifier_ponctuel'),
    valider(z.object({
      salle: z.string().max(50).nullable().optional(),
    })),
    async (req, res, next) => {
      const db = getDB();
      try {
        const enseignant = await getEnseignantConnecte(db, req.session.utilisateur_id);

        // Ownership : ce créneau doit appartenir à une affectation de cet enseignant
        const creneau = await db('emplois_du_temps as edt')
          .join('affectations_enseignants as ae', 'ae.id', 'edt.affectation_id')
          .where({
            'edt.id':           req.params.creneau_id,
            'ae.enseignant_id': enseignant.id,
          })
          .first('edt.id');

        if (!creneau) throw ApiError.nonTrouve('Créneau introuvable ou non autorisé');

        const [updated] = await db('emplois_du_temps')
          .where({ id: req.params.creneau_id })
          .update({ salle: req.body.salle || null })
          .returning('*');

        // Invalider le cache admin EDT enseignant
        // Note : GET /enseignants/moi/edt n'utilise pas Redis (pas de cache),
        // cette invalidation couvre uniquement GET /edt/enseignant/:id (vue admin)
        try {
          await invalidatePattern('edt_ens:' + enseignant.id + '*');
        } catch { /* Redis down, pas critique */ }

        return ok(res, updated);

      } catch (err) { next(err); }
    }
  );
  ```

- [ ] **Step 5 : Lancer le test**

  ```bash
  cd backend
  npx jest tests/integration/enseignants.integration.test.js --no-coverage 2>&1 | tail -20
  ```
  Expected : `PASS`.

- [ ] **Step 6 : Commit**

  ```bash
  git -C .. add backend/src/domains/02-acteurs/enseignants/enseignants.routes.js \
               backend/tests/integration/enseignants.integration.test.js
  git -C .. commit -m "feat: add PUT /enseignants/moi/edt/:id/salle with ownership check"
  ```

---

## Chunk 2 : Frontend — drawer HTML + CSS + ens-edt.js

### Task 4 : Ajouter le drawer dans enseignant.html

**Files:**
- Modify: `dashboard/enseignant.html`

- [ ] **Step 1 : Élargir la page EDT pour la navigation semaine**

  Localiser le bloc `<!-- ═══ PAGE MON EDT ═══ -->` (~ligne 174). Remplacer :

  ```html
  <div class="page" id="page-ens-edt">
    <div class="ph">
      <div><div class="ph-titre">Mon emploi du temps</div><div class="ph-sous" id="ens-edt-annee"></div></div>
    </div>
    <div class="carte">
      <div id="ens-edt-grid" style="padding:16px"></div>
    </div>
  </div>
  ```

  Par :

  ```html
  <div class="page" id="page-ens-edt">
    <div class="ph">
      <div><div class="ph-titre">Mon emploi du temps</div><div class="ph-sous" id="ens-edt-annee"></div></div>
    </div>
    <div class="carte" style="margin-bottom:12px">
      <div style="display:flex;align-items:center;gap:8px;padding:10px 16px;border-bottom:1px solid var(--g100)">
        <button class="btn btn-s" onclick="PageEnsEdt.semainePrec()">← Préc.</button>
        <span id="edt-semaine-label" style="flex:1;text-align:center;font-weight:600;font-size:13px;color:var(--g700)"></span>
        <button class="btn btn-s" onclick="PageEnsEdt.semaineSuiv()">Suiv. →</button>
        <button class="btn btn-s" onclick="PageEnsEdt.semaineAujourdhui()" id="edt-btn-today">Aujourd'hui</button>
      </div>
      <div id="ens-edt-grid" style="padding:16px"></div>
    </div>
  </div>
  ```

- [ ] **Step 2 : Ajouter overlay et drawer avant `<script src="js/ens-router.js">`**

  ```html
  <!-- ═══ EDT DRAWER ═══ -->
  <div id="edt-overlay" onclick="EdtDrawer.fermer()" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:199"></div>
  <div id="edt-drawer" style="position:fixed;top:0;right:0;width:380px;height:100vh;background:var(--blanc);box-shadow:-4px 0 24px rgba(0,0,0,.12);z-index:200;transform:translateX(100%);transition:transform .25s ease;display:flex;flex-direction:column;overflow:hidden">
    <div id="edt-dw-header" style="padding:18px 20px 14px;flex-shrink:0">
      <div style="display:flex;align-items:flex-start;gap:12px">
        <div style="flex:1">
          <div id="edt-dw-matiere" style="font-weight:800;font-size:16px;color:var(--blanc)"></div>
          <div id="edt-dw-meta" style="font-size:12px;color:rgba(255,255,255,.8);margin-top:3px"></div>
        </div>
        <button onclick="EdtDrawer.fermer()" style="background:rgba(255,255,255,.2);border:none;border-radius:6px;width:28px;height:28px;cursor:pointer;font-size:14px;color:var(--blanc)">✕</button>
      </div>
      <div style="display:flex;gap:4px;margin-top:14px">
        <button class="edt-tab actif" id="edt-tab-appel"      onclick="EdtDrawer.onglet('appel')">Appel</button>
        <button class="edt-tab"       id="edt-tab-historique" onclick="EdtDrawer.onglet('historique')">Historique</button>
        <button class="edt-tab"       id="edt-tab-notes"      onclick="EdtDrawer.onglet('notes')">Notes</button>
        <button class="edt-tab"       id="edt-tab-salle"      onclick="EdtDrawer.onglet('salle')">Salle</button>
      </div>
    </div>
    <div id="edt-dw-body" style="flex:1;overflow-y:auto;padding:0 20px 20px"></div>
  </div>
  ```

- [ ] **Step 3 : Ajouter les styles CSS du drawer dans style.css**

  À la fin de la section `/* EDT */` dans `dashboard/css/style.css` (après `.edt-si`), ajouter :

  ```css
  /* EDT Drawer */
  .edt-slot{cursor:pointer}
  .edt-slot:hover{box-shadow:0 2px 8px rgba(0,0,0,.12);transform:translateY(-1px);transition:all .15s ease}
  .edt-tab{background:rgba(255,255,255,.15);border:none;border-radius:6px;padding:5px 10px;font-size:11.5px;font-weight:600;color:rgba(255,255,255,.7);cursor:pointer;transition:all .15s}
  .edt-tab.actif{background:rgba(255,255,255,.9);color:var(--g800)}
  .edt-appel-row{display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--g100)}
  .edt-appel-row:last-child{border-bottom:none}
  .edt-appel-nom{flex:1;font-size:13px;font-weight:500}
  .edt-appel-btn{border:none;border-radius:5px;padding:4px 8px;font-size:11px;font-weight:600;cursor:pointer;opacity:.5;transition:all .15s}
  .edt-appel-btn.actif{opacity:1}
  .edt-appel-btn.p{background:#d1fae5;color:#065f46}
  .edt-appel-btn.a{background:#fee2e2;color:#991b1b}
  .edt-appel-btn.r{background:#fed7aa;color:#92400e}
  ```

- [ ] **Step 4 : Commit**

  ```bash
  git -C .. add dashboard/enseignant.html dashboard/css/style.css
  git -C .. commit -m "feat: add EDT drawer HTML + CSS"
  ```

---

### Task 5 : Réécrire ens-edt.js

**Files:**
- Modify: `dashboard/js/pages/ens-edt.js` (réécriture complète)

- [ ] **Step 1 : Remplacer le contenu complet de ens-edt.js**

  ```javascript
  'use strict';

  // ─── Helpers date ────────────────────────────────────────────────

  /** Retourne le lundi de la semaine contenant `date` (composants locaux, pas UTC) */
  function _edtLundiDe(date) {
    var d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    var jour = d.getDay(); // 0=dim, 1=lun, …, 6=sam
    var diff = (jour === 0) ? -6 : (1 - jour);
    d.setDate(d.getDate() + diff);
    return d;
  }

  /** Formate en YYYY-MM-DD (composants locaux — ne pas utiliser toISOString()) */
  function _edtFmtISO(date) {
    var y  = date.getFullYear();
    var m  = ('0' + (date.getMonth() + 1)).slice(-2);
    var d  = ('0' + date.getDate()).slice(-2);
    return y + '-' + m + '-' + d;
  }

  var _EDT_MOIS  = ['jan.','fév.','mars','avr.','mai','juin','juil.','août','sept.','oct.','nov.','déc.'];
  var _EDT_JOURS = ['Dim','Lun','Mar','Mer','Jeu','Ven','Sam'];

  /** Formate en "Lun 30 mars" */
  function _edtFmtCourt(date) {
    return _EDT_JOURS[date.getDay()] + ' ' + date.getDate() + ' ' + _EDT_MOIS[date.getMonth()];
  }

  // ─── PageEnsEdt : navigation + grille ───────────────────────────

  var PageEnsEdt = {
    _semaine:     null,   // Date (lundi de la semaine affichée)
    _data:        null,
    _creneauxMap: {},     // { creneau_id: creneau } — évite JSON dans onclick

    init: async function() {
      PageEnsEdt._semaine = _edtLundiDe(new Date());
      await PageEnsEdt.charger();
    },

    charger: async function() {
      var grid = document.getElementById('ens-edt-grid');
      if (!grid) return;
      grid.innerHTML = '<div style="text-align:center;padding:40px;color:var(--g400)">Chargement…</div>';
      PageEnsEdt._mettreAJourLabel();

      try {
        var params = { semaine: _edtFmtISO(PageEnsEdt._semaine) };
        var res = await Api.get('/enseignants/moi/edt', params);
        PageEnsEdt._data = res.data;

        var anneeEl = document.getElementById('ens-edt-annee');
        if (anneeEl && res.data.annee) anneeEl.textContent = res.data.annee;

        PageEnsEdt._rendreGrille(res.data);
      } catch (e) {
        if (grid) grid.innerHTML = '<div style="text-align:center;padding:40px;color:var(--rouge);font-size:13px">Emploi du temps indisponible</div>';
      }
    },

    semainePrec: function() {
      PageEnsEdt._semaine.setDate(PageEnsEdt._semaine.getDate() - 7);
      PageEnsEdt.charger();
    },

    semaineSuiv: function() {
      PageEnsEdt._semaine.setDate(PageEnsEdt._semaine.getDate() + 7);
      PageEnsEdt.charger();
    },

    semaineAujourdhui: function() {
      PageEnsEdt._semaine = _edtLundiDe(new Date());
      PageEnsEdt.charger();
    },

    _mettreAJourLabel: function() {
      var label = document.getElementById('edt-semaine-label');
      if (!label || !PageEnsEdt._semaine) return;
      var lundi    = PageEnsEdt._semaine;
      var vendredi = new Date(lundi.getFullYear(), lundi.getMonth(), lundi.getDate() + 4);
      label.textContent = _edtFmtCourt(lundi) + ' – ' + _edtFmtCourt(vendredi);

      var btn = document.getElementById('edt-btn-today');
      if (btn) {
        btn.disabled = (_edtFmtISO(lundi) === _edtFmtISO(_edtLundiDe(new Date())));
      }
    },

    _rendreGrille: function(data) {
      var grid = document.getElementById('ens-edt-grid');
      if (!grid) return;

      PageEnsEdt._creneauxMap = {};

      if (!data || !data.emploi_du_temps || !data.emploi_du_temps.length) {
        grid.innerHTML = '<div style="text-align:center;padding:40px;color:var(--g400);font-size:13px">Aucun cours cette semaine</div>';
        return;
      }

      var jours = data.emploi_du_temps;
      grid.className = 'edt-grid';
      grid.style.gridTemplateColumns = '56px repeat(' + jours.length + ',1fr)';

      // Construire d'abord toute la chaîne HTML (évite les re-parse du DOM)
      var html = '<div class="edt-h"></div>';
      jours.forEach(function(j) {
        html += '<div class="edt-h">' + j.nom + '</div>';
      });

      // Collecter les plages horaires uniques
      var plagesMap = {};
      jours.forEach(function(jour) {
        (jour.creneaux || []).forEach(function(c) {
          var key = c.heure_debut + '-' + c.heure_fin;
          plagesMap[key] = { debut: c.heure_debut, fin: c.heure_fin, numero: c.plage_numero };
        });
      });
      var plages = Object.values(plagesMap).sort(function(a, b) { return a.numero - b.numero; });

      plages.forEach(function(plage) {
        html += '<div class="edt-t">' + plage.debut + '</div>';
        jours.forEach(function(jour) {
          var creneau = (jour.creneaux || []).find(function(c) {
            return c.heure_debut === plage.debut;
          });
          if (creneau && !creneau.est_pause) {
            var col = creneau.couleur_affichage || '#1a4731';
            // Calculer la date ISO de ce créneau (lundi + offset jour_semaine)
            var offsetJour = (creneau.jour_semaine || jour.jour || 1) - 1;
            var dateCreneau = new Date(
              PageEnsEdt._semaine.getFullYear(),
              PageEnsEdt._semaine.getMonth(),
              PageEnsEdt._semaine.getDate() + offsetJour
            );
            var dateISO = _edtFmtISO(dateCreneau);

            // Stocker dans la map pour éviter JSON dans onclick
            PageEnsEdt._creneauxMap[creneau.creneau_id] = creneau;

            html += '<div class="edt-slot" ' +
              'style="background:' + col + '14;border-left:3px solid ' + col + '" ' +
              'onclick="EdtDrawer.ouvrir(\'' + creneau.creneau_id + '\',\'' + dateISO + '\')">' +
              '<div class="edt-sm" style="color:' + col + '">' + (creneau.matiere || '—') + '</div>' +
              '<div class="edt-si" style="color:' + col + '">' + (creneau.classe || '') + (creneau.salle ? ' · ' + creneau.salle : '') + '</div>' +
            '</div>';
          } else {
            html += '<div class="edt-slot vide"></div>';
          }
        });
      });

      grid.innerHTML = html; // Assignation unique — pas de += en boucle
    },

    // Mise à jour locale de la salle après PUT réussi
    mettreAJourSalle: function(creneauId, nouvelleSalle) {
      if (PageEnsEdt._creneauxMap[creneauId]) {
        PageEnsEdt._creneauxMap[creneauId].salle = nouvelleSalle;
      }
      if (PageEnsEdt._data) PageEnsEdt._rendreGrille(PageEnsEdt._data);
    },
  };

  // ─── EdtDrawer : panneau latéral ────────────────────────────────

  var EdtDrawer = {
    _creneau:      null,
    _dateISO:      null,
    _eleves:       [],
    _appelId:      null,
    _statutAppel:  null,

    ouvrir: async function(creneauId, dateISO) {
      var creneau = PageEnsEdt._creneauxMap[creneauId];
      if (!creneau) return;

      EdtDrawer._creneau      = creneau;
      EdtDrawer._dateISO      = dateISO;
      EdtDrawer._eleves       = [];
      EdtDrawer._appelId      = null;
      EdtDrawer._statutAppel  = null;

      // Mettre à jour l'en-tête
      var col = creneau.couleur_affichage || '#1a4731';
      var header = document.getElementById('edt-dw-header');
      if (header) header.style.background = col;

      var matEl = document.getElementById('edt-dw-matiere');
      if (matEl) matEl.textContent = creneau.matiere || '—';

      var metaEl = document.getElementById('edt-dw-meta');
      if (metaEl) metaEl.textContent = EdtDrawer._metaTexte(creneau);

      // Afficher le drawer
      var drawer  = document.getElementById('edt-drawer');
      var overlay = document.getElementById('edt-overlay');
      if (drawer)  drawer.style.transform  = 'translateX(0)';
      if (overlay) overlay.style.display   = 'block';

      // Activer onglet Appel et afficher spinner
      ['appel','historique','notes','salle'].forEach(function(t) {
        var btn = document.getElementById('edt-tab-' + t);
        if (btn) btn.className = 'edt-tab' + (t === 'appel' ? ' actif' : '');
      });
      EdtDrawer._rendreBody('<div style="text-align:center;padding:40px;color:var(--g400)">Chargement…</div>');

      // Charger les données; afficher l'onglet appel seulement si succès
      var ok = await EdtDrawer._chargerDonnees();
      if (ok) EdtDrawer.onglet('appel');
    },

    fermer: function() {
      var drawer  = document.getElementById('edt-drawer');
      var overlay = document.getElementById('edt-overlay');
      if (drawer)  drawer.style.transform = 'translateX(100%)';
      if (overlay) overlay.style.display  = 'none';
    },

    onglet: function(id) {
      ['appel','historique','notes','salle'].forEach(function(t) {
        var btn = document.getElementById('edt-tab-' + t);
        if (btn) btn.className = 'edt-tab' + (t === id ? ' actif' : '');
      });
      if      (id === 'appel')      EdtDrawer._rendreAppel();
      else if (id === 'historique') EdtDrawer._rendreHistorique();
      else if (id === 'notes')      EdtDrawer._rendreNotes();
      else if (id === 'salle')      EdtDrawer._rendreSalle();
    },

    _chargerDonnees: async function() {
      try {
        var res = await Api.get('/appels/cours', {
          emploi_du_temps_id: EdtDrawer._creneau.creneau_id,
          date_cours:          EdtDrawer._dateISO,
        });
        EdtDrawer._appelId     = res.data.appel_id;
        EdtDrawer._statutAppel = res.data.statut;
        EdtDrawer._eleves      = res.data.eleves || [];
        return true;
      } catch (e) {
        EdtDrawer._rendreBody('<div style="color:var(--rouge);padding:20px;font-size:13px">Erreur : ' + (e.message || 'impossible de charger') + '</div>');
        return false;
      }
    },

    _metaTexte: function(creneau) {
      var s = (creneau.classe || '') + ' · ' + (creneau.heure_debut || '') + '–' + (creneau.heure_fin || '');
      if (creneau.salle) s += ' · ' + creneau.salle;
      return s;
    },

    _rendreBody: function(html) {
      var body = document.getElementById('edt-dw-body');
      if (body) body.innerHTML = html;
    },

    _rendreAppel: function() {
      if (EdtDrawer._statutAppel === 'effectue') {
        var nb = { present: 0, absent: 0, retard: 0 };
        EdtDrawer._eleves.forEach(function(e) { if (nb[e.statut] !== undefined) nb[e.statut]++; });
        EdtDrawer._rendreBody(
          '<div style="padding:16px 0">' +
          '<div style="background:var(--g50);border-radius:8px;padding:12px 16px;margin-bottom:12px;font-size:13px;color:var(--g600)">' +
            '✓ Appel clôturé — ' +
            '<span style="color:var(--vert)">'    + nb.present + ' présents</span> · ' +
            '<span style="color:var(--rouge)">'   + nb.absent  + ' absents</span> · ' +
            '<span style="color:var(--orange)">'  + nb.retard  + ' retards</span>' +
          '</div>' +
          '<button class="btn btn-l" style="width:100%" onclick="EdtDrawer.onglet(\'historique\')">Voir le détail →</button>' +
          '</div>'
        );
        return;
      }

      var html = '<div style="padding:8px 0" id="edt-appel-form">';
      if (!EdtDrawer._eleves.length) {
        html += '<div style="color:var(--g400);font-size:13px;text-align:center;padding:20px">Aucun élève inscrit.</div>';
      } else {
        EdtDrawer._eleves.forEach(function(eleve, idx) {
          var st = eleve.statut;
          html += '<div class="edt-appel-row" id="edt-row-' + idx + '">' +
            '<div class="edt-appel-nom">' + eleve.prenom + ' ' + eleve.nom + '</div>' +
            '<button class="edt-appel-btn p' + (st === 'present' ? ' actif' : '') + '" onclick="EdtAppel.saisir(' + idx + ',\'present\')">✓</button>' +
            '<button class="edt-appel-btn a' + (st === 'absent'  ? ' actif' : '') + '" onclick="EdtAppel.saisir(' + idx + ',\'absent\')">✗</button>' +
            '<button class="edt-appel-btn r' + (st === 'retard'  ? ' actif' : '') + '" onclick="EdtAppel.saisir(' + idx + ',\'retard\')">⏱</button>' +
            (st === 'retard'
              ? '<input type="number" min="1" max="120" value="' + (eleve.minutes_retard || 5) + '" id="edt-retard-' + idx + '" style="width:48px;border:1px solid var(--g200);border-radius:4px;font-size:11px;padding:2px 4px" onchange="EdtAppel.retard(' + idx + ',this.value)">'
              : '') +
          '</div>';
        });
        html += '<div style="margin-top:16px">' +
          '<div id="edt-appel-compteur" style="text-align:center;font-size:12px;color:var(--g400);margin-bottom:8px"></div>' +
          '<button class="btn btn-p" id="edt-btn-cloturer" style="width:100%" disabled onclick="EdtAppel.cloturer()">Clôturer l\'appel</button>' +
          '<div id="edt-appel-err" style="color:var(--rouge);font-size:12px;text-align:center;margin-top:6px"></div>' +
        '</div>';
      }
      html += '</div>';
      EdtDrawer._rendreBody(html);
      EdtAppel._mettreAJourCompteur();
    },

    _rendreHistorique: function() {
      var html = '<div style="padding:8px 0">';
      if (EdtDrawer._statutAppel === 'ouvert') {
        html += '<div style="background:#fff7ed;border-radius:6px;padding:8px 12px;font-size:12px;color:var(--orange);margin-bottom:12px">Appel en cours — données partielles</div>';
      }
      if (!EdtDrawer._eleves.length) {
        html += '<div style="color:var(--g400);font-size:13px;text-align:center;padding:20px">Aucun élève</div>';
      } else {
        html += '<table style="width:100%;border-collapse:collapse"><tbody>';
        EdtDrawer._eleves.forEach(function(e) {
          html += '<tr style="border-bottom:1px solid var(--g100)">' +
            '<td style="padding:8px 4px;font-size:13px">' + e.prenom + ' ' + e.nom + '</td>' +
            '<td style="padding:8px 4px">' + EdtDrawer._badge(e) + '</td>' +
          '</tr>';
        });
        html += '</tbody></table>';
      }
      html += '</div>';
      EdtDrawer._rendreBody(html);
    },

    _badge: function(e) {
      var map = {
        present:     '<span style="background:#d1fae5;color:#065f46;border-radius:4px;padding:2px 6px;font-size:11px;font-weight:600">✓ Présent</span>',
        absent:      '<span style="background:#fee2e2;color:#991b1b;border-radius:4px;padding:2px 6px;font-size:11px;font-weight:600">✗ Absent</span>',
        sorti_avant: '<span style="background:var(--g100);color:var(--g600);border-radius:4px;padding:2px 6px;font-size:11px;font-weight:600">Sorti tôt</span>',
        dispense:    '<span style="background:#dbeafe;color:#1e40af;border-radius:4px;padding:2px 6px;font-size:11px;font-weight:600">Dispensé</span>',
        non_saisi:   '<span style="background:var(--g100);color:var(--g400);border-radius:4px;padding:2px 6px;font-size:11px;font-weight:600">—</span>',
      };
      if (e.statut === 'retard') {
        return '<span style="background:#fed7aa;color:#92400e;border-radius:4px;padding:2px 6px;font-size:11px;font-weight:600">⏱ Retard (' + (e.minutes_retard || 0) + 'min)</span>';
      }
      return map[e.statut] || map.non_saisi;
    },

    _rendreNotes: function() {
      EdtDrawer._rendreBody(
        '<div style="padding:24px 0;text-align:center">' +
        '<div style="font-size:13px;color:var(--g500);margin-bottom:16px">' +
          'Classe : <b>' + (EdtDrawer._creneau.classe || '—') + '</b><br>' +
          'Matière : <b>' + (EdtDrawer._creneau.matiere || '—') + '</b>' +
        '</div>' +
        '<button class="btn btn-p" onclick="EdtDrawer.fermer();goto(\'ens-notes\')">→ Ajouter une évaluation</button>' +
        '</div>'
      );
    },

    _rendreSalle: function() {
      var salle = EdtDrawer._creneau.salle || '';
      EdtDrawer._rendreBody(
        '<div style="padding:16px 0">' +
        '<label style="font-size:12px;color:var(--g500);font-weight:600;display:block;margin-bottom:6px">Salle</label>' +
        '<input id="edt-salle-input" type="text" value="' + salle + '" maxlength="50" ' +
          'style="width:100%;border:1px solid var(--g200);border-radius:6px;padding:8px 10px;font-size:13px;box-sizing:border-box" ' +
          'placeholder="ex: Salle B2, Labo 3…">' +
        '<button class="btn btn-p" style="width:100%;margin-top:10px" onclick="EdtAppel.enregistrerSalle()">Enregistrer</button>' +
        '<div id="edt-salle-msg" style="font-size:12px;text-align:center;margin-top:6px"></div>' +
        '</div>'
      );
    },
  };

  // ─── EdtAppel : logique saisie appel + salle ─────────────────────

  var EdtAppel = {

    saisir: function(idx, statut) {
      EdtDrawer._eleves[idx].statut = statut;
      if (statut !== 'retard') EdtDrawer._eleves[idx].minutes_retard = 0;

      var row = document.getElementById('edt-row-' + idx);
      if (row) {
        row.querySelector('.edt-appel-btn.p').className = 'edt-appel-btn p' + (statut === 'present' ? ' actif' : '');
        row.querySelector('.edt-appel-btn.a').className = 'edt-appel-btn a' + (statut === 'absent'  ? ' actif' : '');
        row.querySelector('.edt-appel-btn.r').className = 'edt-appel-btn r' + (statut === 'retard'  ? ' actif' : '');

        var inputExist = document.getElementById('edt-retard-' + idx);
        if (statut === 'retard' && !inputExist) {
          var inp = document.createElement('input');
          inp.type = 'number'; inp.min = 1; inp.max = 120; inp.value = 5;
          inp.id = 'edt-retard-' + idx;
          inp.style.cssText = 'width:48px;border:1px solid var(--g200);border-radius:4px;font-size:11px;padding:2px 4px';
          inp.onchange = (function(i) { return function() { EdtAppel.retard(i, inp.value); }; })(idx);
          row.appendChild(inp);
        } else if (statut !== 'retard' && inputExist) {
          inputExist.remove();
        }
      }
      EdtAppel._mettreAJourCompteur();
    },

    retard: function(idx, minutes) {
      EdtDrawer._eleves[idx].minutes_retard = parseInt(minutes, 10) || 5;
    },

    _mettreAJourCompteur: function() {
      var total  = EdtDrawer._eleves.length;
      var saisis = EdtDrawer._eleves.filter(function(e) { return e.statut !== 'non_saisi'; }).length;
      var comp   = document.getElementById('edt-appel-compteur');
      var btn    = document.getElementById('edt-btn-cloturer');
      if (comp) comp.textContent = saisis + '/' + total + ' élèves saisis';
      if (btn)  btn.disabled = (saisis < total);
    },

    cloturer: async function() {
      var btn = document.getElementById('edt-btn-cloturer');
      var err = document.getElementById('edt-appel-err');
      if (btn) { btn.disabled = true; btn.textContent = 'Enregistrement…'; }
      if (err) err.textContent = '';

      try {
        // Étape 1 : créer l'appel si besoin
        // POST /appels retourne { appel_id, nb_eleves } — utiliser .appel_id
        var appelId = EdtDrawer._appelId;
        if (!appelId) {
          var postRes = await Api.post('/appels', {
            emploi_du_temps_id: EdtDrawer._creneau.creneau_id,
            date_cours:          EdtDrawer._dateISO,
          });
          appelId = postRes.data.appel_id;
          EdtDrawer._appelId = appelId;
        }

        // Étape 2 : soumettre toutes les présences avec cloturer:true
        var presences = EdtDrawer._eleves.map(function(e) {
          var p = { inscription_id: e.inscription_id, statut: e.statut };
          if (e.statut === 'retard' && e.minutes_retard) p.minutes_retard = e.minutes_retard;
          return p;
        });

        await Api.put('/appels/' + appelId + '/presences', {
          presences: presences,
          cloturer:  true,
        });

        EdtDrawer._statutAppel = 'effectue';
        EdtDrawer.onglet('appel');

      } catch (e) {
        if (btn) { btn.disabled = false; btn.textContent = "Clôturer l'appel"; }
        if (err) err.textContent = e.message || 'Erreur lors de la clôture';
      }
    },

    enregistrerSalle: async function() {
      var input = document.getElementById('edt-salle-input');
      var msg   = document.getElementById('edt-salle-msg');
      if (!input) return;
      var nouvelle = input.value.trim();
      if (msg) { msg.style.color = 'var(--g400)'; msg.textContent = 'Enregistrement…'; }

      try {
        await Api.put('/enseignants/moi/edt/' + EdtDrawer._creneau.creneau_id + '/salle', { salle: nouvelle });
        EdtDrawer._creneau.salle = nouvelle;

        // Mettre à jour l'en-tête du drawer
        var metaEl = document.getElementById('edt-dw-meta');
        if (metaEl) metaEl.textContent = EdtDrawer._metaTexte(EdtDrawer._creneau);

        // Mettre à jour la grille (DOM update local)
        PageEnsEdt.mettreAJourSalle(EdtDrawer._creneau.creneau_id, nouvelle);

        if (msg) { msg.style.color = 'var(--vert)'; msg.textContent = '✓ Salle mise à jour'; }
      } catch (e) {
        if (msg) { msg.style.color = 'var(--rouge)'; msg.textContent = e.message || 'Erreur'; }
      }
    },
  };

  // ─── Hook ────────────────────────────────────────────────────────
  PAGE_HOOKS['ens-edt'] = function() { PageEnsEdt.init(); };
  ```

- [ ] **Step 2 : Vérifier la syntaxe**

  ```bash
  node --check "dashboard/js/pages/ens-edt.js" && echo "OK"
  ```
  Expected : `OK`.

- [ ] **Step 3 : Smoke test backend**

  ```bash
  cd backend
  npx jest tests/integration/ --no-coverage 2>&1 | tail -30
  ```
  Expected : tous les tests passent.

- [ ] **Step 4 : Commit**

  ```bash
  git -C .. add dashboard/js/pages/ens-edt.js
  git -C .. commit -m "feat: rewrite ens-edt.js with week nav, colors, and drawer"
  ```

---

## Chunk 3 : Vérification DB + test manuel

### Task 6 : Vérifier les contraintes CHECK

- [ ] **Step 1 : Lancer les tests appels**

  ```bash
  cd backend
  npx jest tests/integration/appels.integration.test.js --no-coverage 2>&1 | tail -20
  ```

  Si FAIL avec `violates check constraint`, exécuter :

  ```bash
  node -e "
  const { getDB } = require('./src/infrastructure/database/pool');
  const db = getDB();
  db.raw(\`
    ALTER TABLE appels DROP CONSTRAINT IF EXISTS appels_statut_check;
    ALTER TABLE appels ADD CONSTRAINT appels_statut_check
      CHECK (statut IN ('ouvert', 'effectue', 'cours_annule', 'non_effectue'));
    ALTER TABLE presences DROP CONSTRAINT IF EXISTS presences_statut_check;
    ALTER TABLE presences ADD CONSTRAINT presences_statut_check
      CHECK (statut IN ('non_saisi', 'present', 'absent', 'retard', 'sorti_avant', 'dispense'));
  \`).then(() => { console.log('Migration OK'); process.exit(0); }).catch(e => { console.error(e.message); process.exit(1); });
  "
  ```
  Expected : `Migration OK`.

- [ ] **Step 2 : Relancer tous les tests**

  ```bash
  cd backend
  npx jest tests/ --no-coverage --testPathIgnorePatterns=node_modules 2>&1 | tail -30
  ```
  Expected : `PASS` partout.

- [ ] **Step 3 : Commiter la migration si elle a été nécessaire**

  ```bash
  cat > migrations/010_fix_appels_presences_check_constraints.sql << 'EOF'
  -- Fix: ajouter 'ouvert' à appels.statut et 'non_saisi' à presences.statut
  ALTER TABLE appels DROP CONSTRAINT IF EXISTS appels_statut_check;
  ALTER TABLE appels ADD CONSTRAINT appels_statut_check
    CHECK (statut IN ('ouvert', 'effectue', 'cours_annule', 'non_effectue'));

  ALTER TABLE presences DROP CONSTRAINT IF EXISTS presences_statut_check;
  ALTER TABLE presences ADD CONSTRAINT presences_statut_check
    CHECK (statut IN ('non_saisi', 'present', 'absent', 'retard', 'sorti_avant', 'dispense'));
  EOF
  git -C .. add backend/migrations/010_fix_appels_presences_check_constraints.sql
  git -C .. commit -m "fix: add ouvert/non_saisi to appels/presences check constraints"
  ```

---

### Task 7 : Test manuel end-to-end

- [ ] **Step 1 : Démarrer le backend**

  ```bash
  cd backend && npm run dev
  ```

- [ ] **Step 2 : Ouvrir `enseignant.html` → "Mon EDT"**

  Vérifier :
  - Barre navigation semaine visible avec label "Lun JJ mois – Ven JJ mois"
  - Grille chargée avec couleurs issues de la DB (plus de couleurs hardcodées)
  - Créneaux cliquables (curseur pointer, hover élévation)

- [ ] **Step 3 : Tester la navigation semaine**

  Cliquer "← Préc." → label change, grille recharge. Cliquer "Aujourd'hui" → revient, bouton grisé.

- [ ] **Step 4 : Ouvrir le drawer**

  Cliquer un créneau → drawer glisse depuis la droite, en-tête coloré, onglet Appel actif, liste élèves.

- [ ] **Step 5 : Faire un appel complet**

  Marquer tous les élèves → bouton "Clôturer l'appel" s'active → cliquer → succès → résumé "Appel clôturé".

- [ ] **Step 6 : Tester l'onglet Salle**

  Ouvrir un créneau → "Salle" → modifier → Enregistrer → "✓ Salle mise à jour" + la carte dans la grille se met à jour.

- [ ] **Step 7 : Tester la fermeture**

  Clic ✕ ou overlay → drawer se ferme, aucune erreur console.
