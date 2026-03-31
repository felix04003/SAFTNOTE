# Espace Enseignant — Dashboard SP2 — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Créer le portail web enseignant (6 pages HTML/CSS/JS vanilla) branché sur les APIs backend existantes : tableau de bord, mes classes, mes notes, appel du jour, EDT, discipline.

**Architecture:** Nouveau fichier `enseignant.html` (portail dédié, séparé de `index.html` admin). Même pattern que le dashboard existant : pages `<div class="page">`, fichiers `js/pages/ens-*.js`, routing hash via `ens-router.js`. `auth.js` redirige les enseignants vers `enseignant.html` après login.

**Tech Stack:** HTML/CSS/JS vanilla (ES2017+, async/await), aucune dépendance NPM. Réutilise `js/api.js`, `js/auth.js`, `js/config.js`, `js/ui.js` existants. CSS additionnel dans `css/style.css`.

---

## Carte des fichiers

| Fichier | Action | Responsabilité |
|---------|--------|----------------|
| `dashboard/enseignant.html` | Créer | Structure HTML complète du portail enseignant (sidebar, 6 pages, modals) |
| `dashboard/js/ens-router.js` | Créer | TITRES + PAGE_HOOKS + `goto()` pour les pages enseignant |
| `dashboard/js/ens-app.js` | Créer | DOMContentLoaded init, auth check, populate sidebar, routing hash initial |
| `dashboard/js/pages/ens-dashboard.js` | Créer | 3 KPI + liste d'actions urgentes (appels du jour + notes en retard) |
| `dashboard/js/pages/ens-classes.js` | Créer | Grille des classes affectées (matière, effectif, salle) |
| `dashboard/js/pages/ens-appel.js` | Créer | Créneaux du jour → sélection créneau → grille d'appel → soumission |
| `dashboard/js/pages/ens-edt.js` | Créer | Grille hebdomadaire (adapté de `edt.js`) |
| `dashboard/js/pages/ens-notes.js` | Créer | Liste évaluations enseignant + modal création + modal saisie notes |
| `dashboard/js/pages/ens-discipline.js` | Créer | Liste sanctions + modal création (classe → élève → type + motif) |
| `dashboard/js/auth.js` | Modifier | Ajouter redirection `enseignant.html` si rôle = `enseignant` après login |
| `dashboard/css/style.css` | Modifier | Ajouter `.appel-grid`, `.appel-row`, `.kpi-actions` (petits ajouts seulement) |

---

## Chunk 1 : Socle — HTML + routing + auth redirect

### Task 1 : Modifier `auth.js` — redirection enseignant

**Files:**
- Modify: `dashboard/js/auth.js` (lignes 1-13)

- [ ] **Step 1 : Lire le fichier actuel**

```bash
# Vérifier auth.js
cat dashboard/js/auth.js
```

- [ ] **Step 2 : Modifier la méthode `login()` pour détecter le rôle**

Remplacer dans `auth.js` la ligne `window.location.href = 'index.html';` par :

```javascript
async login(identifiant, mot_de_passe, etablissement_code) {
  var res = await Api.post('/auth/connexion', {
    identifiant: identifiant,
    mot_de_passe: mot_de_passe,
    etablissement_code: etablissement_code
  });
  localStorage.setItem(CONFIG.TOKEN_KEY, res.data.token);
  localStorage.setItem(CONFIG.USER_KEY, JSON.stringify(res.data.utilisateur));
  // Redirection selon le rôle
  var roles = (res.data.utilisateur && res.data.utilisateur.roles) || [];
  var estEnseignant = roles.includes('enseignant') &&
    !roles.some(function(r) {
      return r === 'directeur' || r === 'censeur' || r === 'admin' || r === 'super_admin';
    });
  window.location.href = estEnseignant ? 'enseignant.html' : 'index.html';
},
```

> **Note :** Si `utilisateur.role` (string singulier) est utilisé plutôt que `roles` (array), adapter : `var estEnseignant = res.data.utilisateur.role === 'enseignant';`

- [ ] **Step 3 : Vérifier la structure de la réponse auth backend**

```bash
# Regarder le format exact de la réponse dans le backend
grep -n "roles\|role" backend/src/domains/02-acteurs/auth/auth.routes.js | head -30
```

Adapter le code Step 2 selon ce que retourne réellement l'API.

- [ ] **Step 4 : Commit**

```bash
git add dashboard/js/auth.js
git commit -m "feat(dashboard): redirection enseignant.html selon rôle après login"
```

---

### Task 2 : Créer `ens-router.js`

**Files:**
- Create: `dashboard/js/ens-router.js`

- [ ] **Step 1 : Créer le fichier**

```javascript
'use strict';

var ENS_TITRES = {
  'ens-dashboard':  'Mon tableau de bord',
  'ens-classes':    'Mes classes',
  'ens-notes':      'Mes notes & évaluations',
  'ens-appel':      'Faire l\'appel',
  'ens-edt':        'Mon emploi du temps',
  'ens-discipline': 'Discipline',
};

var PAGE_HOOKS = {};

function goto(id) {
  document.querySelectorAll('.page').forEach(function(p) { p.classList.remove('active'); });
  var pageEl = document.getElementById('page-' + id);
  if (pageEl) pageEl.classList.add('active');
  document.querySelectorAll('.nav-item').forEach(function(n) {
    n.classList.toggle('actif', n.dataset.page === id);
  });
  var titreEl = document.getElementById('tb-titre');
  if (titreEl) titreEl.textContent = ENS_TITRES[id] || id;
  history.replaceState(null, '', '#' + id);
  if (PAGE_HOOKS[id]) PAGE_HOOKS[id]();
}

window.addEventListener('hashchange', function() {
  var id = location.hash.slice(1);
  if (id && ENS_TITRES[id]) goto(id);
});
```

- [ ] **Step 2 : Commit**

```bash
git add dashboard/js/ens-router.js
git commit -m "feat(dashboard): ens-router.js — routing hash pour le portail enseignant"
```

---

### Task 3 : Créer `ens-app.js`

**Files:**
- Create: `dashboard/js/ens-app.js`

- [ ] **Step 1 : Créer le fichier**

```javascript
'use strict';

document.addEventListener('DOMContentLoaded', function() {
  // Vérifier l'authentification
  if (!Auth.requireAuth()) return;

  // Peupler la sidebar avec le nom/rôle de l'enseignant
  Auth.populateSidebar();

  // Date dans la topbar
  var dateEl = document.getElementById('ph-sous-date');
  if (dateEl) {
    var now = new Date();
    var opts = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    var dateStr = now.toLocaleDateString('fr-FR', opts);
    dateStr = dateStr.charAt(0).toUpperCase() + dateStr.slice(1);
    var user = Auth.getUser();
    var etab = (user && user.etablissement_nom) ? user.etablissement_nom : 'EcoleManager';
    dateEl.textContent = etab + ' · ' + dateStr;
  }

  // Bouton déconnexion
  var logoutBtn = document.getElementById('btn-logout');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', function(e) {
      e.preventDefault();
      Auth.logout();
    });
  }

  // Routing hash initial
  var hash = location.hash.slice(1);
  if (hash && ENS_TITRES[hash]) {
    goto(hash);
  } else {
    goto('ens-dashboard');
  }
});
```

- [ ] **Step 2 : Commit**

```bash
git add dashboard/js/ens-app.js
git commit -m "feat(dashboard): ens-app.js — initialisation du portail enseignant"
```

---

### Task 4 : Créer `enseignant.html`

**Files:**
- Create: `dashboard/enseignant.html`

- [ ] **Step 1 : Créer la structure HTML complète**

`enseignant.html` suit exactement la même structure que `index.html` (sidebar + topbar + content), mais avec :
- 6 pages enseignant uniquement
- Tous les modals nécessaires (appel, notes, création éval, discipline)
- Scripts chargés dans l'ordre : `config.js` → `api.js` → `auth.js` → `ui.js` → `ens-router.js` → pages → `ens-app.js`

```html
<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>EcoleManager — Espace Enseignant</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700;800&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="css/style.css">
</head>
<body>

<aside class="sidebar">
  <div class="sb-logo">
    <div class="sb-mark">EM</div>
    <div class="sb-app">EcoleManager</div>
    <div class="sb-etab" id="sb-etab-nom"></div>
  </div>
  <nav class="sb-nav">
    <div class="nav-sec">Général</div>
    <a class="nav-item actif" data-page="ens-dashboard" onclick="goto('ens-dashboard')"><span class="nav-ico">📊</span>Tableau de bord</a>
    <div class="nav-sec">Mes activités</div>
    <a class="nav-item" data-page="ens-classes" onclick="goto('ens-classes')"><span class="nav-ico">🏫</span>Mes classes</a>
    <a class="nav-item" data-page="ens-notes" onclick="goto('ens-notes')"><span class="nav-ico">📝</span>Mes notes</a>
    <a class="nav-item" data-page="ens-appel" onclick="goto('ens-appel')"><span class="nav-ico">✅</span>Faire l'appel</a>
    <a class="nav-item" data-page="ens-edt" onclick="goto('ens-edt')"><span class="nav-ico">🗓️</span>Mon EDT</a>
    <div class="nav-sec">Vie scolaire</div>
    <a class="nav-item" data-page="ens-discipline" onclick="goto('ens-discipline')"><span class="nav-ico">⚠️</span>Discipline</a>
  </nav>
  <div class="sb-user">
    <div class="u-avatar" id="sb-user-avatar">?</div>
    <div style="flex:1"><div class="u-name" id="sb-user-nom"></div><div class="u-role" id="sb-user-role"></div></div>
    <a href="#" id="btn-logout" title="Déconnexion" style="color:rgba(255,255,255,.4);font-size:16px;text-decoration:none;padding:4px">🚪</a>
  </div>
</aside>

<main class="main">
  <header class="topbar">
    <span class="tb-titre" id="tb-titre">Tableau de bord</span>
    <span class="tb-annee" id="tb-annee">📅 —</span>
    <div class="tb-notif" title="Notifications">🔔<span class="notif-dot"></span></div>
  </header>

  <div class="content">
    <!-- ═══ PAGE DASHBOARD ENSEIGNANT ═══ -->
    <div class="page active" id="page-ens-dashboard">
      <div class="ph">
        <div>
          <div class="ph-titre" id="ens-greeting">Bonjour 👋</div>
          <div class="ph-sous" id="ph-sous-date"></div>
        </div>
        <button class="btn btn-p" onclick="goto('ens-appel')">✅ Faire l'appel</button>
      </div>

      <!-- 3 KPI -->
      <div class="sg" style="grid-template-columns:repeat(3,1fr)">
        <div class="sc" style="--c:var(--vert)">
          <div class="sc-ico">🏫</div>
          <div class="sc-val" id="ens-kpi-classes">—</div>
          <div class="sc-lbl">Classes affectées</div>
        </div>
        <div class="sc" style="--c:var(--bleu)">
          <div class="sc-ico">🎓</div>
          <div class="sc-val" id="ens-kpi-eleves">—</div>
          <div class="sc-lbl">Élèves au total</div>
        </div>
        <div class="sc" style="--c:var(--orange)">
          <div class="sc-ico">📝</div>
          <div class="sc-val" id="ens-kpi-saisir">—</div>
          <div class="sc-lbl">Évals à saisir</div>
        </div>
      </div>

      <!-- Actions urgentes -->
      <div class="g2">
        <div class="carte">
          <div class="ch"><span>⏰</span><span class="ct">Appels à faire aujourd'hui</span></div>
          <div id="ens-appels-jour" style="padding:12px 18px"></div>
        </div>
        <div class="carte">
          <div class="ch"><span>⚠️</span><span class="ct">Notes en attente</span><a class="ca" onclick="goto('ens-notes')">Tout voir →</a></div>
          <div id="ens-notes-attente" style="padding:12px 18px"></div>
        </div>
      </div>
    </div>

    <!-- ═══ PAGE MES CLASSES ═══ -->
    <div class="page" id="page-ens-classes">
      <div class="ph">
        <div><div class="ph-titre">Mes classes</div><div class="ph-sous" id="ens-classes-sous">—</div></div>
      </div>
      <div id="ens-classes-grid" class="g3"></div>
    </div>

    <!-- ═══ PAGE MES NOTES ═══ -->
    <div class="page" id="page-ens-notes">
      <div class="ph">
        <div><div class="ph-titre">Mes notes & évaluations</div></div>
        <button class="btn btn-p" onclick="PageEnsNotes.ouvrirModalEval()">+ Nouvelle évaluation</button>
      </div>
      <div style="display:flex;gap:10px;margin-bottom:16px">
        <select class="fi" id="ens-fil-classe" onchange="PageEnsNotes.filtrerClasse(this.value)" style="flex:1">
          <option value="">Toutes mes classes</option>
        </select>
        <select class="fi" id="ens-fil-statut" onchange="PageEnsNotes.filtrerStatut(this.value)" style="width:180px">
          <option value="">Tous les statuts</option>
          <option value="non_saisie">À saisir</option>
          <option value="brouillon">Brouillon</option>
          <option value="publiee">Publiées</option>
        </select>
      </div>
      <div class="carte">
        <div class="tw">
          <table>
            <thead><tr>
              <th>Matière</th><th>Classe</th><th>Type</th><th>Date</th>
              <th>Moy. classe</th><th>Statut</th><th>Action</th>
            </tr></thead>
            <tbody id="tb-ens-eval"></tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- ═══ PAGE FAIRE L'APPEL ═══ -->
    <div class="page" id="page-ens-appel">
      <div class="ph">
        <div><div class="ph-titre">Faire l'appel</div><div class="ph-sous" id="appel-date-aujourd-hui"></div></div>
      </div>

      <!-- État 1 : liste des créneaux du jour -->
      <div id="appel-etape-creneaux">
        <div class="carte">
          <div class="ch"><span>🗓️</span><span class="ct">Créneaux d'aujourd'hui</span></div>
          <div id="appel-creneaux-liste" style="padding:16px 18px"></div>
        </div>
      </div>

      <!-- État 2 : grille d'appel (masqué par défaut) -->
      <div id="appel-etape-grille" style="display:none">
        <div class="ph" style="margin-bottom:14px">
          <div>
            <div class="ph-titre" id="appel-grille-titre">—</div>
            <div class="ph-sous" id="appel-grille-sous">—</div>
          </div>
          <button class="btn btn-l" onclick="PageEnsAppel.retourCreneaux()">← Retour</button>
        </div>
        <div class="carte">
          <div class="ch">
            <span>✅</span>
            <span class="ct" id="appel-grille-nb">— élèves</span>
            <button class="btn btn-p btn-sm" id="btn-appel-marquer-tous" onclick="PageEnsAppel.marquerTousPresents()" style="margin-left:auto">Tous présents</button>
          </div>
          <div class="tw">
            <table>
              <thead><tr>
                <th>Élève</th>
                <th style="text-align:center">Présent</th>
                <th style="text-align:center">Absent</th>
                <th style="text-align:center">Retard</th>
                <th>Minutes retard</th>
              </tr></thead>
              <tbody id="tb-appel-grille"></tbody>
            </table>
          </div>
          <div style="padding:14px 18px;border-top:1px solid var(--g100);display:flex;justify-content:flex-end;gap:10px">
            <button class="btn btn-p" id="btn-appel-soumettre" onclick="PageEnsAppel.soumettre()">Soumettre l'appel</button>
          </div>
        </div>
      </div>
    </div>

    <!-- ═══ PAGE MON EDT ═══ -->
    <div class="page" id="page-ens-edt">
      <div class="ph">
        <div><div class="ph-titre">Mon emploi du temps</div><div class="ph-sous" id="ens-edt-annee"></div></div>
      </div>
      <div class="carte">
        <div id="ens-edt-grid" style="padding:16px"></div>
      </div>
    </div>

    <!-- ═══ PAGE DISCIPLINE ═══ -->
    <div class="page" id="page-ens-discipline">
      <div class="ph">
        <div><div class="ph-titre">Discipline</div></div>
        <button class="btn btn-p" onclick="PageEnsDiscipline.ouvrirModal()">+ Signaler un incident</button>
      </div>
      <div style="display:flex;gap:10px;margin-bottom:16px">
        <select class="fi" id="ens-disc-fil-classe" onchange="PageEnsDiscipline.filtrerClasse(this.value)" style="flex:1">
          <option value="">Toutes mes classes</option>
        </select>
        <select class="fi" id="ens-disc-fil-type" onchange="PageEnsDiscipline.filtrerType(this.value)" style="width:200px">
          <option value="">Tous les types</option>
          <option value="avertissement_oral">Avertissement oral</option>
          <option value="avertissement_ecrit">Avertissement écrit</option>
          <option value="retenue">Retenue</option>
          <option value="renvoi_temporaire">Renvoi temporaire</option>
        </select>
      </div>
      <div class="carte">
        <div class="tw">
          <table>
            <thead><tr>
              <th>Élève</th><th>Classe</th><th>Type</th><th>Date</th><th>Motif</th><th>Parent notifié</th>
            </tr></thead>
            <tbody id="tb-ens-sanctions"></tbody>
          </table>
        </div>
        <div id="pag-ens-disc" style="display:flex;justify-content:space-between;align-items:center;padding:12px 18px;border-top:1px solid var(--g100)"></div>
      </div>
    </div>

  </div><!-- /.content -->
</main>

<!-- ─── TOAST CONTAINER ─── -->
<div id="tc" style="position:fixed;bottom:24px;right:24px;z-index:9999;display:flex;flex-direction:column;gap:8px"></div>

<!-- ═══════════════════════════════
     MODALS
     ═══════════════════════════════ -->

<!-- Modal : Nouvelle évaluation -->
<div class="mo" id="m-ens-evaluation">
  <div class="md" style="width:500px">
    <div class="md-h"><span class="md-titre">Nouvelle évaluation</span><button class="md-cl" onclick="closeModal('m-ens-evaluation')">✕</button></div>
    <div class="md-b">
      <div class="fg">
        <label class="fl">Classe *</label>
        <select class="fi" id="ens-ev-classe" onchange="PageEnsNotes.onClasseChangeEval()">
          <option value="">— Choisir une classe —</option>
        </select>
      </div>
      <div class="fg">
        <label class="fl">Matière *</label>
        <select class="fi" id="ens-ev-affectation">
          <option value="">— Sélectionnez d'abord une classe —</option>
        </select>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="fg">
          <label class="fl">Type *</label>
          <select class="fi" id="ens-ev-type">
            <option value="">— Type —</option>
            <option value="devoir">Devoir</option>
            <option value="interro">Interro</option>
            <option value="examen">Examen</option>
            <option value="tp">TP</option>
            <option value="oral">Oral</option>
          </select>
        </div>
        <div class="fg">
          <label class="fl">Numéro</label>
          <input class="fi" type="number" id="ens-ev-numero" value="1" min="1" max="99">
        </div>
      </div>
      <div class="fg">
        <label class="fl">Titre (optionnel)</label>
        <input class="fi" type="text" id="ens-ev-titre" placeholder="ex : Devoir maison — Fonctions">
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="fg">
          <label class="fl">Note max</label>
          <input class="fi" type="number" id="ens-ev-note-max" value="20" min="1" max="100" step="0.5">
        </div>
        <div class="fg">
          <label class="fl">Date de l'évaluation</label>
          <input class="fi" type="date" id="ens-ev-date">
        </div>
      </div>
      <div class="fg">
        <label class="fl">Période *</label>
        <select class="fi" id="ens-ev-periode">
          <option value="">— Période —</option>
        </select>
      </div>
    </div>
    <div class="md-f">
      <button class="btn btn-l" onclick="closeModal('m-ens-evaluation')">Annuler</button>
      <button class="btn btn-p" id="btn-ens-creer-eval" onclick="PageEnsNotes.creerEvaluation()">Créer l'évaluation</button>
    </div>
  </div>
</div>

<!-- Modal : Saisie des notes -->
<div class="mo" id="m-ens-notes">
  <div class="md" style="width:640px;max-height:80vh">
    <div class="md-h">
      <span class="md-titre" id="ens-notes-modal-titre">Saisie des notes</span>
      <button class="md-cl" onclick="closeModal('m-ens-notes')">✕</button>
    </div>
    <div class="md-b" style="overflow-y:auto;max-height:60vh">
      <div class="tw">
        <table>
          <thead><tr>
            <th>Élève</th>
            <th style="text-align:center">Absent</th>
            <th>Note</th>
            <th>Appréciation</th>
          </tr></thead>
          <tbody id="tb-ens-notes-saisie"></tbody>
        </table>
      </div>
    </div>
    <div class="md-f">
      <button class="btn btn-l" onclick="closeModal('m-ens-notes')">Fermer</button>
      <button class="btn btn-l" id="btn-ens-sauver-notes" onclick="PageEnsNotes.sauvegarderNotes()">Enregistrer</button>
      <button class="btn btn-p" id="btn-ens-publier-notes" onclick="PageEnsNotes.publierNotes()">📱 Publier (notif parents)</button>
    </div>
  </div>
</div>

<!-- Modal : Signaler une sanction discipline -->
<div class="mo" id="m-ens-discipline">
  <div class="md" style="width:480px">
    <div class="md-h"><span class="md-titre">Signaler une sanction</span><button class="md-cl" onclick="closeModal('m-ens-discipline')">✕</button></div>
    <div class="md-b">
      <div class="fg">
        <label class="fl">Classe *</label>
        <select class="fi" id="disc-classe" onchange="PageEnsDiscipline.chargerElevesClasse(this.value)">
          <option value="">— Choisir une classe —</option>
        </select>
      </div>
      <div class="fg">
        <label class="fl">Élève *</label>
        <select class="fi" id="disc-eleve" disabled>
          <option value="">— Sélectionnez d'abord une classe —</option>
        </select>
      </div>
      <div class="fg">
        <label class="fl">Type de sanction *</label>
        <select class="fi" id="disc-type">
          <option value="">— Type —</option>
          <option value="avertissement_oral">Avertissement oral</option>
          <option value="avertissement_ecrit">Avertissement écrit</option>
          <option value="retenue">Retenue</option>
          <option value="renvoi_temporaire">Renvoi temporaire</option>
          <option value="conseil_discipline">Conseil de discipline</option>
        </select>
      </div>
      <div class="fg">
        <label class="fl">Motif * (min. 5 caractères)</label>
        <textarea class="fi" id="disc-motif" rows="3" placeholder="Décrivez le comportement sanctionné…" style="resize:vertical"></textarea>
      </div>
      <div class="fg">
        <label class="fl">Date (optionnel)</label>
        <input class="fi" type="date" id="disc-date">
      </div>
    </div>
    <div class="md-f">
      <button class="btn btn-l" onclick="closeModal('m-ens-discipline')">Annuler</button>
      <button class="btn btn-p" id="btn-disc-creer" onclick="PageEnsDiscipline.creerSanction()">Enregistrer la sanction</button>
    </div>
  </div>
</div>

<!-- ─── SCRIPTS ─── -->
<script src="js/config.js"></script>
<script src="js/api.js"></script>
<script src="js/auth.js"></script>
<script src="js/ui.js"></script>
<script src="js/ens-router.js"></script>
<script src="js/pages/ens-dashboard.js"></script>
<script src="js/pages/ens-classes.js"></script>
<script src="js/pages/ens-notes.js"></script>
<script src="js/pages/ens-appel.js"></script>
<script src="js/pages/ens-edt.js"></script>
<script src="js/pages/ens-discipline.js"></script>
<script src="js/ens-app.js"></script>
</body>
</html>
```

> **CSS classes manquantes** à ajouter dans `style.css` (Step suivant) : `.mo`, `.md`, `.md-h`, `.md-titre`, `.md-cl`, `.md-b`, `.md-f`, `.fg`, `.fl`, `.fi`, `.btn`, `.btn-p`, `.btn-l`, `.btn-sm`.
>
> **Vérifier** : Ces classes existent déjà dans `css/style.css` (utilisées dans `index.html`). Si oui, aucune modification CSS nécessaire pour ce step.

- [ ] **Step 2 : Vérifier que les classes CSS existent déjà**

```bash
grep -c "\.mo\|\.md\b\|\.md-h\|\.fg\|\.fl\b\|\.fi\b" dashboard/css/style.css
```

Si la commande retourne > 0, les styles modaux sont déjà présents — pas de modification CSS nécessaire.

- [ ] **Step 3 : Commit**

```bash
git add dashboard/enseignant.html
git commit -m "feat(dashboard): enseignant.html — structure HTML complète du portail enseignant"
```

---

## Chunk 2 : Pages JavaScript — Dashboard, Classes, EDT

### Task 5 : `ens-dashboard.js` — Tableau de bord enseignant

**Files:**
- Create: `dashboard/js/pages/ens-dashboard.js`

**API utilisées :**
- `GET /enseignants/moi/classes` → nb classes + sum effectifs
- `GET /evaluations?statut=non_saisie` → nb évals à saisir
- `GET /enseignants/moi/edt` → créneaux du jour (filtrer par `jour_semaine` = jour JS actuel)

- [ ] **Step 1 : Créer le fichier**

```javascript
'use strict';

var PageEnsDashboard = {
  _classes: [],

  async init() {
    var user = Auth.getUser();
    var greet = document.getElementById('ens-greeting');
    if (greet) greet.textContent = 'Bonjour, ' + (user && user.prenom ? user.prenom : 'Enseignant') + ' 👋';

    // Charger en parallèle
    await Promise.all([
      this._chargerKPI(),
      this._chargerAppelsJour(),
      this._chargerNotesAttente(),
    ]);
  },

  async _chargerKPI() {
    try {
      var res = await Api.get('/enseignants/moi/classes');
      this._classes = res.data || [];
      var nbClasses = this._classes.length;
      var nbEleves = this._classes.reduce(function(sum, c) { return sum + (c.effectif || 0); }, 0);

      _set('ens-kpi-classes', nbClasses);
      _set('ens-kpi-eleves', nbEleves);

      // Mettre à jour l'année dans topbar
      var anneeEl = document.getElementById('tb-annee');
      if (anneeEl && res.meta && res.meta.annee) anneeEl.textContent = '📅 ' + res.meta.annee;
    } catch (e) {
      _set('ens-kpi-classes', '—');
      _set('ens-kpi-eleves', '—');
    }

    // Évals à saisir
    try {
      var r2 = await Api.get('/evaluations', { statut: 'non_saisie' });
      _set('ens-kpi-saisir', (r2.data || []).length);
    } catch (e) {
      _set('ens-kpi-saisir', '—');
    }
  },

  async _chargerAppelsJour() {
    var el = document.getElementById('ens-appels-jour');
    if (!el) return;

    try {
      var res = await Api.get('/enseignants/moi/edt');
      var edt = res.data && res.data.emploi_du_temps || [];

      // Jour JS : 0=Dim, 1=Lun... → adapter : Lundi=1, Mardi=2...
      var jourJS = new Date().getDay(); // 0-6
      // Convertir : Lundi=1, Mardi=2, Mercredi=3, Jeudi=4, Vendredi=5, Samedi=6
      // JS: Dim=0, Lun=1, Mar=2, Mer=3, Jeu=4, Ven=5, Sam=6
      var jourEDT = jourJS; // correspond directement (backend: 1=Lun, 6=Sam)

      var jourAuj = edt.find(function(j) { return j.jour === jourEDT; });
      var creneaux = (jourAuj && jourAuj.creneaux) || [];
      creneaux = creneaux.filter(function(c) { return !c.est_pause; });

      if (!creneaux.length) {
        el.innerHTML = '<div style="text-align:center;padding:20px;color:var(--g400);font-size:13px">Aucun cours aujourd\'hui 🎉</div>';
        return;
      }

      el.innerHTML = creneaux.map(function(c) {
        return '<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--g100)">' +
          '<div>' +
            '<div style="font-weight:600;font-size:13px">' + (c.matiere || '—') + ' · <span style="color:var(--g500)">' + (c.classe || '') + '</span></div>' +
            '<div style="font-size:11.5px;color:var(--g400);margin-top:2px">' + (c.heure_debut || '') + ' – ' + (c.heure_fin || '') + (c.salle ? ' · ' + c.salle : '') + '</div>' +
          '</div>' +
          '<button class="btn btn-p btn-sm" onclick="PageEnsAppel.lancerDepuisCreneau(\'' + c.creneau_id + '\',\'' + (c.matiere || '') + '\',\'' + (c.classe || '') + '\',\'' + (c.classe_id || '') + '\')">Faire l\'appel</button>' +
        '</div>';
      }).join('');

    } catch (e) {
      el.innerHTML = '<div style="text-align:center;padding:20px;color:var(--g400);font-size:13px">Impossible de charger les créneaux</div>';
    }
  },

  async _chargerNotesAttente() {
    var el = document.getElementById('ens-notes-attente');
    if (!el) return;

    try {
      var res = await Api.get('/evaluations', { statut: 'non_saisie' });
      var evals = (res.data || []).slice(0, 5); // max 5 dans le widget

      if (!evals.length) {
        el.innerHTML = '<div style="text-align:center;padding:20px;color:var(--g400);font-size:13px">Aucune note en attente ✓</div>';
        return;
      }

      el.innerHTML = evals.map(function(ev) {
        return '<div style="display:flex;align-items:center;justify-content:space-between;padding:9px 0;border-bottom:1px solid var(--g100)">' +
          '<div>' +
            '<div style="font-weight:600;font-size:13px">' + (ev.matiere || '—') + '</div>' +
            '<div style="font-size:11.5px;color:var(--g400)">' + (ev.classe || '') + ' · ' + (ev.type || '') + ' · ' + (ev.date_evaluation || '—') + '</div>' +
          '</div>' +
          '<button class="btn btn-l btn-sm" onclick="PageEnsNotes.ouvrirSaisie(\'' + ev.id + '\',\'' + (ev.matiere || '') + ' — ' + (ev.classe || '') + '\');goto(\'ens-notes\')">Saisir →</button>' +
        '</div>';
      }).join('');

    } catch (e) {
      el.innerHTML = '<div style="text-align:center;padding:20px;color:var(--g400);font-size:13px">Indisponible</div>';
    }
  },
};

// Helper local
function _set(id, val) {
  var el = document.getElementById(id);
  if (el) el.textContent = (val != null) ? val : '—';
}

PAGE_HOOKS['ens-dashboard'] = function() { PageEnsDashboard.init(); };
```

- [ ] **Step 2 : Commit**

```bash
git add dashboard/js/pages/ens-dashboard.js
git commit -m "feat(dashboard): ens-dashboard.js — tableau de bord enseignant (KPI + actions urgentes)"
```

---

### Task 6 : `ens-classes.js` — Mes classes

**Files:**
- Create: `dashboard/js/pages/ens-classes.js`

**API :** `GET /enseignants/moi/classes`

- [ ] **Step 1 : Créer le fichier**

```javascript
'use strict';

var PageEnsClasses = {
  _data: [],

  async charger() {
    var grid = document.getElementById('ens-classes-grid');
    if (!grid) return;
    grid.innerHTML = '<div style="text-align:center;padding:40px;color:var(--g400)">Chargement…</div>';

    try {
      var res = await Api.get('/enseignants/moi/classes');
      this._data = res.data || [];

      var sous = document.getElementById('ens-classes-sous');
      if (sous && res.meta) sous.textContent = res.meta.annee + ' · ' + this._data.length + ' affectation(s)';

      if (!this._data.length) {
        grid.innerHTML = '<div style="text-align:center;padding:40px;color:var(--g400)">Aucune classe affectée cette année</div>';
        return;
      }

      grid.innerHTML = this._data.map(function(c) {
        return '<div class="carte" style="padding:18px">' +
          '<div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:12px">' +
            '<div>' +
              '<div style="font-size:17px;font-weight:800;color:var(--g900)">' + (c.classe || '—') + '</div>' +
              '<div style="font-size:12px;color:var(--vert-lt);font-weight:600;margin-top:2px">' + (c.matiere || '—') + '</div>' +
            '</div>' +
            '<span class="badge ' + (c.est_titulaire ? 'bs' : 'bw') + '">' + (c.est_titulaire ? 'Titulaire' : 'Vacataire') + '</span>' +
          '</div>' +
          '<div style="display:flex;gap:16px;font-size:12px;color:var(--g500)">' +
            '<span>🎓 <b style="color:var(--g900)">' + (c.effectif || 0) + '</b> élèves</span>' +
            (c.salle_principale ? '<span>📍 ' + c.salle_principale + '</span>' : '') +
            '<span style="font-size:10px;background:var(--g100);padding:2px 8px;border-radius:10px;color:var(--g500)">' + (c.cycle || c.niveau || '') + '</span>' +
          '</div>' +
          '<div style="margin-top:14px;display:flex;gap:8px">' +
            '<button class="btn btn-l btn-sm" onclick="PageEnsNotes.filtrerParClasse(\'' + c.classe_id + '\');goto(\'ens-notes\')">📝 Notes</button>' +
            '<button class="btn btn-l btn-sm" onclick="PageEnsAppel.filtrerParClasse(\'' + c.classe_id + '\');goto(\'ens-appel\')">✅ Appel</button>' +
          '</div>' +
        '</div>';
      }).join('');

    } catch (e) {
      grid.innerHTML = '<div style="text-align:center;padding:40px;color:var(--rouge)">Erreur : ' + (e.message || 'impossible de charger les classes') + '</div>';
    }
  },

  init: function() { this.charger(); },
};

PAGE_HOOKS['ens-classes'] = function() { PageEnsClasses.init(); };
```

- [ ] **Step 2 : Commit**

```bash
git add dashboard/js/pages/ens-classes.js
git commit -m "feat(dashboard): ens-classes.js — grille des classes affectées"
```

---

### Task 7 : `ens-edt.js` — Mon emploi du temps

**Files:**
- Create: `dashboard/js/pages/ens-edt.js`

**API :** `GET /enseignants/moi/edt` (même endpoint que `edt.js` existant, même format de réponse)

- [ ] **Step 1 : Créer le fichier (adapté de `edt.js`)**

```javascript
'use strict';

var PageEnsEdt = {
  async charger() {
    var grid = document.getElementById('ens-edt-grid');
    if (!grid) return;

    try {
      var res = await Api.get('/enseignants/moi/edt');
      var anneeEl = document.getElementById('ens-edt-annee');
      if (anneeEl && res.data && res.data.annee) anneeEl.textContent = res.data.annee;
      this._renderGrid(grid, res.data);
    } catch (e) {
      grid.innerHTML = '<div style="text-align:center;padding:40px;color:var(--g400);font-size:13px">Emploi du temps indisponible</div>';
    }
  },

  _renderGrid(grid, data) {
    if (!data || !data.emploi_du_temps || !data.emploi_du_temps.length) {
      grid.innerHTML = '<div style="text-align:center;padding:40px;color:var(--g400)">Aucun créneau dans l\'emploi du temps</div>';
      return;
    }

    grid.className = 'edt-grid';

    var jours = [''].concat(data.emploi_du_temps.map(function(j) { return j.nom; }));
    grid.innerHTML = jours.map(function(j) {
      return '<div class="edt-h">' + j + '</div>';
    }).join('');

    var plages = {};
    data.emploi_du_temps.forEach(function(jour) {
      (jour.creneaux || []).forEach(function(c) {
        var key = c.heure_debut + '-' + c.heure_fin;
        plages[key] = { debut: c.heure_debut, fin: c.heure_fin, numero: c.plage_numero };
      });
    });

    var plagesArr = Object.values(plages).sort(function(a, b) { return a.numero - b.numero; });
    var cmat = {
      'Mathématiques': '#1A5276', 'Physique': '#7D3C98', 'SVT': '#1E8449',
      'Français': '#B7950B', 'Anglais': '#1B4F72', 'Philo': '#6C3483',
      'Histoire-Géo': '#935116', 'EPS': '#1A6B3A',
    };

    plagesArr.forEach(function(plage) {
      grid.innerHTML += '<div class="edt-t">' + plage.debut + '</div>';
      data.emploi_du_temps.forEach(function(jour) {
        var creneau = (jour.creneaux || []).find(function(c) { return c.heure_debut === plage.debut; });
        if (creneau && !creneau.est_pause) {
          var mat = creneau.matiere || '';
          var col = cmat[mat] || '#1A4731';
          grid.innerHTML += '<div class="edt-slot" style="background:' + col + '14;border-left:3px solid ' + col + '">' +
            '<div class="edt-sm" style="color:' + col + '">' + mat + '</div>' +
            '<div class="edt-si" style="color:' + col + '">' + (creneau.classe || '') + (creneau.salle ? ' · ' + creneau.salle : '') + '</div>' +
          '</div>';
        } else {
          grid.innerHTML += '<div class="edt-slot vide"></div>';
        }
      });
    });
  },

  init: function() { this.charger(); },
};

PAGE_HOOKS['ens-edt'] = function() { PageEnsEdt.init(); };
```

- [ ] **Step 2 : Commit**

```bash
git add dashboard/js/pages/ens-edt.js
git commit -m "feat(dashboard): ens-edt.js — grille hebdomadaire enseignant"
```

---

## Chunk 3 : Pages avancées — Appel, Notes, Discipline

### Task 8 : `ens-appel.js` — Faire l'appel

**Files:**
- Create: `dashboard/js/pages/ens-appel.js`

**Flow :**
1. `init()` → `GET /enseignants/moi/edt` → filter `jour_semaine == today` → afficher liste créneaux
2. Click créneau → `POST /appels {emploi_du_temps_id, date_cours}` → récupérer `appel_id`
3. `GET /classes/:classe_id/eleves` → afficher grille appel
4. Submit → `PUT /appels/:appel_id/presences` → toast succès

**API :**
- `GET /enseignants/moi/edt`
- `POST /appels`
- `GET /classes/:classe_id/eleves`
- `PUT /appels/:appel_id/presences`

- [ ] **Step 1 : Créer le fichier**

```javascript
'use strict';

var PageEnsAppel = {
  _appelId: null,
  _classeId: null,
  _eleves: [],
  _filtreClasseId: null,  // filtre pré-sélectionné depuis ens-classes

  async init() {
    // Date du jour dans le header
    var dateEl = document.getElementById('appel-date-aujourd-hui');
    if (dateEl) {
      var now = new Date();
      var opts = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
      dateEl.textContent = now.toLocaleDateString('fr-FR', opts);
    }

    // Reset état
    this._appelId = null;
    this._classeId = null;
    this._eleves = [];

    // Toujours afficher la liste des créneaux au (re)chargement
    this.retourCreneaux();
    await this._chargerCreneaux();
  },

  retourCreneaux() {
    var etapeCreneaux = document.getElementById('appel-etape-creneaux');
    var etapeGrille = document.getElementById('appel-etape-grille');
    if (etapeCreneaux) etapeCreneaux.style.display = '';
    if (etapeGrille) etapeGrille.style.display = 'none';
  },

  async _chargerCreneaux() {
    var liste = document.getElementById('appel-creneaux-liste');
    if (!liste) return;
    liste.innerHTML = '<div style="padding:20px;text-align:center;color:var(--g400)">Chargement…</div>';

    try {
      var res = await Api.get('/enseignants/moi/edt');
      var edt = res.data && res.data.emploi_du_temps || [];

      // Jour de la semaine : JS 0=Dim,1=Lun... backend 1=Lun,6=Sam
      var jourJS = new Date().getDay(); // 0-6
      // Backend utilise 1=Lun,2=Mar,...,6=Sam (Dim=0 pas de cours)
      var jourEDT = jourJS;  // coïncide directement

      var jourAuj = edt.find(function(j) { return j.jour === jourEDT; });
      var creneaux = (jourAuj && jourAuj.creneaux) || [];
      creneaux = creneaux.filter(function(c) { return !c.est_pause; });

      // Si filtre classe pré-sélectionné (venu de ens-classes)
      if (this._filtreClasseId) {
        creneaux = creneaux.filter(function(c) { return c.classe_id === PageEnsAppel._filtreClasseId; });
        this._filtreClasseId = null;
      }

      if (!creneaux.length) {
        liste.innerHTML = '<div style="text-align:center;padding:32px;color:var(--g400)">' +
          '<div style="font-size:32px;margin-bottom:12px">🎉</div>' +
          '<div style="font-weight:600;font-size:14px;color:var(--g500)">Pas de cours aujourd\'hui</div>' +
          '<div style="font-size:12px;margin-top:6px">Consultez votre <a onclick="goto(\'ens-edt\')" style="color:var(--vert-lt);cursor:pointer">emploi du temps</a> pour la semaine.</div>' +
        '</div>';
        return;
      }

      liste.innerHTML = creneaux.map(function(c) {
        return '<div style="display:flex;align-items:center;justify-content:space-between;padding:14px 0;border-bottom:1px solid var(--g100)">' +
          '<div>' +
            '<div style="font-weight:700;font-size:14px;color:var(--g900)">' + (c.matiere || '—') + '</div>' +
            '<div style="font-size:12.5px;color:var(--g500);margin-top:3px">' +
              (c.classe || '') + ' · ' + (c.heure_debut || '') + ' – ' + (c.heure_fin || '') +
              (c.salle ? ' · <span style="color:var(--g400)">' + c.salle + '</span>' : '') +
            '</div>' +
          '</div>' +
          '<button class="btn btn-p" ' +
            'onclick="PageEnsAppel.selectionnerCreneau(\'' + c.creneau_id + '\',\'' + (c.matiere || '') + '\',\'' + (c.classe || '') + '\',\'' + (c.classe_id || '') + '\')">' +
            'Faire l\'appel →' +
          '</button>' +
        '</div>';
      }).join('');

    } catch (e) {
      liste.innerHTML = '<div style="text-align:center;padding:28px;color:var(--rouge);font-size:13px">Impossible de charger les créneaux : ' + (e.message || '') + '</div>';
    }
  },

  // Appelé depuis le dashboard (bouton rapide)
  lancerDepuisCreneau(creneauId, matiere, classe, classeId) {
    goto('ens-appel');
    // Petit délai pour laisser la page s'afficher
    setTimeout(function() {
      PageEnsAppel.selectionnerCreneau(creneauId, matiere, classe, classeId);
    }, 200);
  },

  // Filtre pré-sélectionné depuis ens-classes
  filtrerParClasse(classeId) {
    this._filtreClasseId = classeId;
  },

  async selectionnerCreneau(creneauId, matiere, classe, classeId) {
    this._classeId = classeId;

    // Afficher la grille
    var etapeCreneaux = document.getElementById('appel-etape-creneaux');
    var etapeGrille = document.getElementById('appel-etape-grille');
    if (etapeCreneaux) etapeCreneaux.style.display = 'none';
    if (etapeGrille) etapeGrille.style.display = '';

    // Titre de la grille
    var titre = document.getElementById('appel-grille-titre');
    var sous = document.getElementById('appel-grille-sous');
    if (titre) titre.textContent = matiere + ' — ' + classe;
    if (sous) {
      var now = new Date();
      sous.textContent = now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    }

    // État du tableau
    var tbody = document.getElementById('tb-appel-grille');
    if (tbody) tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:30px;color:var(--g400)">Ouverture de l\'appel…</td></tr>';

    try {
      // 1. Ouvrir l'appel (idempotent)
      var today = new Date().toISOString().split('T')[0];
      var res = await Api.post('/appels', {
        emploi_du_temps_id: creneauId,
        date_cours: today,
      });
      this._appelId = res.data && res.data.appel_id;

      // 2. Charger les élèves de la classe
      var elevesRes = await Api.get('/classes/' + classeId + '/eleves');
      this._eleves = elevesRes.data || [];

      var nbEl = document.getElementById('appel-grille-nb');
      if (nbEl) nbEl.textContent = this._eleves.length + ' élève(s)';

      this._renderGrille(this._eleves);

    } catch (e) {
      if (tbody) tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:30px;color:var(--rouge)">Erreur : ' + (e.message || 'impossible d\'ouvrir l\'appel') + '</td></tr>';
    }
  },

  _renderGrille(eleves) {
    var tbody = document.getElementById('tb-appel-grille');
    if (!tbody) return;

    if (!eleves.length) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:30px;color:var(--g400)">Aucun élève dans cette classe</td></tr>';
      return;
    }

    tbody.innerHTML = eleves.map(function(el, i) {
      var nom = (el.nom || '') + ' ' + (el.prenom || '');
      return '<tr id="ar-' + i + '">' +
        '<td style="font-weight:600">' + nom + '<input type="hidden" class="ar-inscr" value="' + (el.inscription_id || '') + '"></td>' +
        '<td style="text-align:center"><input type="radio" name="stat-' + i + '" class="ar-stat" value="present" checked onchange="PageEnsAppel._onStatChange(' + i + ')"></td>' +
        '<td style="text-align:center"><input type="radio" name="stat-' + i + '" class="ar-stat" value="absent" onchange="PageEnsAppel._onStatChange(' + i + ')"></td>' +
        '<td style="text-align:center"><input type="radio" name="stat-' + i + '" class="ar-stat" value="retard" onchange="PageEnsAppel._onStatChange(' + i + ')"></td>' +
        '<td><input type="number" class="fi ar-retard" min="1" max="120" placeholder="min" disabled style="width:72px;padding:3px 7px;font-size:12px"></td>' +
      '</tr>';
    }).join('');
  },

  _onStatChange(i) {
    var row = document.getElementById('ar-' + i);
    if (!row) return;
    var stat = row.querySelector('input[name="stat-' + i + '"]:checked')?.value;
    var retardInput = row.querySelector('.ar-retard');
    if (retardInput) retardInput.disabled = (stat !== 'retard');
  },

  marquerTousPresents() {
    document.querySelectorAll('#tb-appel-grille tr').forEach(function(row, i) {
      var radio = row.querySelector('input[value="present"]');
      if (radio) { radio.checked = true; PageEnsAppel._onStatChange(i); }
    });
  },

  async soumettre() {
    if (!this._appelId) return toast('Appel non initialisé', 'w');

    var rows = document.querySelectorAll('#tb-appel-grille tr[id^="ar-"]');
    var presences = [];

    rows.forEach(function(row, i) {
      var inscriptionId = row.querySelector('.ar-inscr')?.value;
      var stat = row.querySelector('input[name="stat-' + i + '"]:checked')?.value || 'present';
      var minutesRetard = parseInt(row.querySelector('.ar-retard')?.value) || undefined;

      if (inscriptionId) {
        var p = { inscription_id: inscriptionId, statut: stat };
        if (stat === 'retard' && minutesRetard) p.minutes_retard = minutesRetard;
        presences.push(p);
      }
    });

    if (!presences.length) return toast('Aucune présence à enregistrer', 'w');

    var btn = document.getElementById('btn-appel-soumettre');
    if (btn) { btn.disabled = true; btn.textContent = 'Enregistrement…'; }

    try {
      await Api.put('/appels/' + this._appelId + '/presences', {
        presences: presences,
        cloturer: true,
      });

      var nbAbsents = presences.filter(function(p) { return p.statut === 'absent' || p.statut === 'retard'; }).length;
      toast('Appel enregistré ✓' + (nbAbsents ? ' — ' + nbAbsents + ' absence(s) signalée(s), parents notifiés 📱' : ''), 's');
      this.retourCreneaux();
      await this._chargerCreneaux();

    } catch (e) {
      toast(e.message || 'Erreur lors de la soumission', 'e');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Soumettre l\'appel'; }
    }
  },

  init: function() { PageEnsAppel._init(); },
  _init: async function() { await PageEnsAppel.init(); },
};

PAGE_HOOKS['ens-appel'] = function() { PageEnsAppel.init(); };
```

- [ ] **Step 2 : Commit**

```bash
git add dashboard/js/pages/ens-appel.js
git commit -m "feat(dashboard): ens-appel.js — flux complet faire l'appel (créneaux → grille → soumission)"
```

---

### Task 9 : `ens-notes.js` — Mes notes & évaluations

**Files:**
- Create: `dashboard/js/pages/ens-notes.js`

**Logique :** Identique à `notes.js` existant mais filtré pour l'enseignant connecté (l'API `/evaluations` retourne seulement ses évaluations via JWT). Réutilise le même pattern de modals et de grille de saisie.

- [ ] **Step 1 : Vérifier que `/evaluations` filtre bien par enseignant**

```bash
grep -n "enseignant\|utilisateur_id\|session" backend/src/domains/03-pedagogie/evaluations/evaluations.routes.js | head -20
```

Si l'endpoint ne filtre pas par enseignant automatiquement via JWT, adapter la requête en ajoutant `?enseignant_id=moi` ou vérifier avec le backend team.

- [ ] **Step 2 : Créer le fichier**

```javascript
'use strict';

var PageEnsNotes = {
  _data: [],
  _classes: [],      // [{classe_id, classe, affectation_id, matiere}]
  _periodes: [],
  _evalCourant: null,
  _filtreClasseId: '',
  _filtreStatut: '',

  async init() {
    await Promise.all([this._chargerClasses(), this._chargerPeriodes()]);
    this._peuplerFiltreClasses();
    await this.charger();
  },

  async _chargerClasses() {
    try {
      var res = await Api.get('/enseignants/moi/classes');
      this._classes = res.data || [];
    } catch (e) { this._classes = []; }
  },

  async _chargerPeriodes() {
    try {
      var r = await Api.get('/annees-scolaires/courante');
      this._periodes = (r.data && r.data.periodes) || [];
    } catch (e) { this._periodes = []; }
  },

  _peuplerFiltreClasses() {
    var sel = document.getElementById('ens-fil-classe');
    if (!sel) return;
    // Dédupliquer les classes (un enseignant peut avoir plusieurs matières dans une même classe)
    var vues = {};
    var classes = this._classes.filter(function(c) {
      if (vues[c.classe_id]) return false;
      vues[c.classe_id] = true;
      return true;
    });
    sel.innerHTML = '<option value="">Toutes mes classes</option>' +
      classes.map(function(c) {
        return '<option value="' + c.classe_id + '">' + c.classe + '</option>';
      }).join('');
    if (this._filtreClasseId) sel.value = this._filtreClasseId;
  },

  // Appelé depuis ens-classes (raccourci)
  filtrerParClasse(classeId) {
    this._filtreClasseId = classeId;
  },

  filtrerClasse(classeId) { this._filtreClasseId = classeId; this.charger(); },
  filtrerStatut(statut) { this._filtreStatut = statut; this.charger(); },

  async charger() {
    var tbody = document.getElementById('tb-ens-eval');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--g400)">Chargement…</td></tr>';

    try {
      var params = {};
      if (this._filtreClasseId) params.classe_id = this._filtreClasseId;
      if (this._filtreStatut)   params.statut = this._filtreStatut;

      var res = await Api.get('/evaluations', params);
      this._data = res.data || [];
      this._renderTable(this._data);
    } catch (e) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--rouge)">' + (e.message || 'Erreur de chargement') + '</td></tr>';
    }
  },

  _renderTable(evals) {
    var tbody = document.getElementById('tb-ens-eval');
    if (!tbody) return;

    if (!evals.length) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--g400);padding:30px">Aucune évaluation — créez-en une avec "+ Nouvelle évaluation"</td></tr>';
      return;
    }

    tbody.innerHTML = evals.map(function(ev) {
      var moy = ev.moyenne_classe != null ? ev.moyenne_classe : null;
      var st = ev.statut || 'non_saisie';
      var badge = st === 'publiee'
        ? '<span class="badge bs">Publiée</span>'
        : st === 'brouillon'
          ? '<span class="badge bw">Brouillon</span>'
          : '<span class="badge bd">À saisir</span>';

      var titre = (ev.titre || (ev.type + ' ' + (ev.numero || ''))) + ' — ' + (ev.classe || '');

      return '<tr style="cursor:pointer" onclick="PageEnsNotes.ouvrirSaisie(\'' + ev.id + '\',\'' + titre + '\')">' +
        '<td class="nc">' + (ev.matiere || '—') + '</td>' +
        '<td><span class="badge bp">' + (ev.classe || '—') + '</span></td>' +
        '<td><span class="badge bo">' + (ev.type || '—') + '</span></td>' +
        '<td style="font-family:\'Space Mono\',monospace;font-size:11.5px">' + (ev.date_evaluation || '—') + '</td>' +
        '<td>' + (moy != null ? '<span style="font-weight:700;color:' + cn(moy) + '">' + moy + '/20</span>' : '<span class="badge bd">—</span>') + '</td>' +
        '<td>' + badge + '</td>' +
        '<td onclick="event.stopPropagation()">' +
          (st !== 'publiee'
            ? '<button class="btn btn-l btn-sm" onclick="event.stopPropagation();PageEnsNotes.ouvrirSaisie(\'' + ev.id + '\',\'' + titre + '\')">✏️ Saisir</button>'
            : '<button class="btn btn-sm" style="background:var(--g100);color:var(--g500);cursor:default">👁 Voir</button>') +
        '</td>' +
      '</tr>';
    }).join('');
  },

  // ── Modal création évaluation ────────────────────────────────────
  async ouvrirModalEval() {
    var selClasse = document.getElementById('ens-ev-classe');
    if (selClasse) {
      // Dédupliquer les classes
      var vues = {};
      var classes = this._classes.filter(function(c) {
        if (vues[c.classe_id]) return false;
        vues[c.classe_id] = true;
        return true;
      });
      selClasse.innerHTML = '<option value="">— Choisir une classe —</option>' +
        classes.map(function(c) {
          return '<option value="' + c.classe_id + '">' + c.classe + '</option>';
        }).join('');
      // Reset affectations
      var selAff = document.getElementById('ens-ev-affectation');
      if (selAff) selAff.innerHTML = '<option value="">— Sélectionnez d\'abord une classe —</option>';
    }
    var selPer = document.getElementById('ens-ev-periode');
    if (selPer) {
      selPer.innerHTML = this._periodes.map(function(p) {
        return '<option value="' + p.id + '">' + p.libelle + '</option>';
      }).join('');
    }
    openModal('m-ens-evaluation');
  },

  async onClasseChangeEval() {
    var classeId = document.getElementById('ens-ev-classe')?.value;
    var selAff = document.getElementById('ens-ev-affectation');
    if (!selAff) return;
    if (!classeId) {
      selAff.innerHTML = '<option value="">— Sélectionnez d\'abord une classe —</option>';
      return;
    }
    // Filtrer les affectations de cet enseignant pour cette classe
    var aff = this._classes.filter(function(c) { return c.classe_id === classeId; });
    if (aff.length) {
      selAff.innerHTML = '<option value="">— Choisir la matière —</option>' +
        aff.map(function(a) {
          return '<option value="' + a.affectation_id + '">' + a.matiere + '</option>';
        }).join('');
    } else {
      selAff.innerHTML = '<option value="">Aucune affectation pour cette classe</option>';
    }
  },

  async creerEvaluation() {
    var affId    = document.getElementById('ens-ev-affectation')?.value;
    var periodeId = document.getElementById('ens-ev-periode')?.value;
    var type     = document.getElementById('ens-ev-type')?.value;
    var numero   = parseInt(document.getElementById('ens-ev-numero')?.value) || 1;
    var titre    = document.getElementById('ens-ev-titre')?.value?.trim();
    var noteMax  = parseFloat(document.getElementById('ens-ev-note-max')?.value) || 20;
    var date     = document.getElementById('ens-ev-date')?.value;

    if (!affId)     return toast('Sélectionnez une matière', 'w');
    if (!periodeId) return toast('Sélectionnez une période', 'w');
    if (!type)      return toast('Sélectionnez un type', 'w');

    var btn = document.getElementById('btn-ens-creer-eval');
    if (btn) { btn.disabled = true; btn.textContent = 'Création…'; }

    try {
      var payload = { affectation_id: affId, periode_id: periodeId, type, numero, note_max: noteMax };
      if (titre) payload.titre = titre;
      if (date)  payload.date_evaluation = date;

      await Api.post('/evaluations', payload);
      closeModal('m-ens-evaluation');
      toast('Évaluation créée ✓ — vous pouvez maintenant saisir les notes', 's');
      await this.charger();
    } catch (e) {
      toast(e.message || 'Erreur de création', 'e');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Créer l\'évaluation'; }
    }
  },

  // ── Modal saisie des notes ────────────────────────────────────────
  async ouvrirSaisie(evalId, titre) {
    this._evalCourant = { id: evalId, titre };

    var titreEl = document.getElementById('ens-notes-modal-titre');
    if (titreEl) titreEl.textContent = titre || 'Saisie des notes';

    var tbody = document.getElementById('tb-ens-notes-saisie');
    if (tbody) tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:30px;color:var(--g400)">Chargement…</td></tr>';

    openModal('m-ens-notes');

    try {
      var evalRes = await Api.get('/evaluations/' + evalId + '/notes');
      var notesSaisies = evalRes.data || [];
      var notesMap = {};
      notesSaisies.forEach(function(n) { notesMap[n.eleve_id] = n; });

      var evalInfo = (PageEnsNotes._data || []).find(function(e) { return e.id === evalId; });
      PageEnsNotes._evalCourant.note_max  = evalInfo ? evalInfo.note_max  : 20;
      PageEnsNotes._evalCourant.statut    = evalInfo ? evalInfo.statut    : 'non_saisie';
      PageEnsNotes._evalCourant.classe_id = evalInfo ? evalInfo.classe_id : null;

      var eleves = [];
      if (evalInfo && evalInfo.classe_id) {
        var elevesRes = await Api.get('/classes/' + evalInfo.classe_id + '/eleves');
        eleves = elevesRes.data || [];
      }
      if (!eleves.length && notesSaisies.length) {
        eleves = notesSaisies.map(function(n) {
          return { id: n.eleve_id, nom: n.nom, prenom: n.prenom, inscription_id: n.inscription_id || '' };
        });
      }

      PageEnsNotes._renderGrille(eleves, notesMap, PageEnsNotes._evalCourant.note_max);

      var estPubliee = PageEnsNotes._evalCourant.statut === 'publiee';
      var btnPublier = document.getElementById('btn-ens-publier-notes');
      var btnSauver  = document.getElementById('btn-ens-sauver-notes');
      if (btnPublier) btnPublier.style.display = estPubliee ? 'none' : '';
      if (btnSauver)  btnSauver.style.display  = estPubliee ? 'none' : '';

    } catch (e) {
      if (tbody) tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:30px;color:var(--rouge)">Erreur : ' + (e.message || '') + '</td></tr>';
    }
  },

  _renderGrille(eleves, notesMap, noteMax) {
    var tbody = document.getElementById('tb-ens-notes-saisie');
    if (!tbody) return;
    if (!eleves.length) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:30px;color:var(--g400)">Aucun élève</td></tr>';
      return;
    }
    tbody.innerHTML = eleves.map(function(el, i) {
      var note = notesMap[el.id] || {};
      var absent = note.est_absent || false;
      return '<tr id="nr-' + i + '">' +
        '<td><span style="font-weight:600">' + el.nom + '</span> ' + el.prenom +
          '<input type="hidden" class="nr-eleve-id" value="' + el.id + '">' +
          '<input type="hidden" class="nr-inscription" value="' + (el.inscription_id || '') + '">' +
        '</td>' +
        '<td style="text-align:center"><input type="checkbox" class="nr-absent" ' + (absent ? 'checked' : '') +
          ' onchange="PageEnsNotes._toggleAbsent(this,' + i + ')"></td>' +
        '<td><input type="number" class="fi nr-valeur" min="0" max="' + noteMax + '" step="0.5"' +
          ' value="' + (note.valeur != null ? note.valeur : '') + '"' +
          ' placeholder="/' + noteMax + '" ' + (absent ? 'disabled' : '') +
          ' style="width:90px;padding:4px 8px;font-size:13px"></td>' +
        '<td><input type="text" class="fi nr-appreciation" placeholder="Appréciation…"' +
          ' value="' + (note.appreciation || '') + '"' +
          ' style="font-size:12px;padding:4px 8px"></td>' +
      '</tr>';
    }).join('');
  },

  _toggleAbsent(checkbox, i) {
    var row = document.getElementById('nr-' + i);
    if (!row) return;
    var input = row.querySelector('.nr-valeur');
    if (input) { input.disabled = checkbox.checked; if (checkbox.checked) input.value = ''; }
  },

  async sauvegarderNotes() {
    var ev = this._evalCourant;
    if (!ev) return;

    var rows = document.querySelectorAll('#tb-ens-notes-saisie tr[id^="nr-"]');
    var notes = [];
    rows.forEach(function(row) {
      var eleveId = row.querySelector('.nr-eleve-id')?.value;
      var inscriptionId = row.querySelector('.nr-inscription')?.value;
      var absent = row.querySelector('.nr-absent')?.checked || false;
      var valeurRaw = row.querySelector('.nr-valeur')?.value;
      var appreciation = row.querySelector('.nr-appreciation')?.value?.trim() || undefined;
      var valeur = valeurRaw !== '' ? parseFloat(valeurRaw) : null;
      if (eleveId) notes.push({ eleve_id: eleveId, inscription_id: inscriptionId, est_absent: absent, absence_justifiee: false, valeur, appreciation });
    });

    if (!notes.length) return toast('Aucune note à enregistrer', 'w');

    var btn = document.getElementById('btn-ens-sauver-notes');
    if (btn) { btn.disabled = true; btn.textContent = 'Enregistrement…'; }

    try {
      await Api.put('/evaluations/' + ev.id + '/notes', { notes });
      toast(notes.length + ' notes enregistrées ✓', 's');
      await this.charger();
    } catch (e) {
      toast(e.message || 'Erreur d\'enregistrement', 'e');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Enregistrer'; }
    }
  },

  async publierNotes() {
    var ev = this._evalCourant;
    if (!ev) return;
    if (!confirm('Publier les notes ? Les parents seront notifiés par SMS/WhatsApp.')) return;

    var btn = document.getElementById('btn-ens-publier-notes');
    if (btn) { btn.disabled = true; btn.textContent = 'Publication…'; }

    try {
      await PageEnsNotes.sauvegarderNotes();
      await Api.put('/evaluations/' + ev.id + '/publier', {});
      toast('Notes publiées — parents notifiés 📱', 's');
      closeModal('m-ens-notes');
      await this.charger();
    } catch (e) {
      toast(e.message || 'Erreur de publication', 'e');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '📱 Publier (notif parents)'; }
    }
  },

  init: function() { PageEnsNotes._init(); },
  _init: async function() { await PageEnsNotes.init(); },
};

PAGE_HOOKS['ens-notes'] = function() { PageEnsNotes.init(); };
```

- [ ] **Step 3 : Commit**

```bash
git add dashboard/js/pages/ens-notes.js
git commit -m "feat(dashboard): ens-notes.js — liste évals + création + saisie notes enseignant"
```

---

### Task 10 : `ens-discipline.js` — Discipline

**Files:**
- Create: `dashboard/js/pages/ens-discipline.js`

**API :**
- `GET /discipline/sanctions` (liste paginée, filtrable par classe_id et type)
- `GET /classes/:id/eleves` → pour peupler le select élève dans le modal
- `POST /discipline/sanctions` (requiert `inscription_id`)

**Contrainte :** `POST /discipline/sanctions` requiert `inscription_id` (pas `eleve_id`). Le `GET /classes/:id/eleves` doit retourner `inscription_id`. Vérifier cela en Step 1.

- [ ] **Step 1 : Vérifier que `/classes/:id/eleves` retourne `inscription_id`**

```bash
grep -n "inscription_id\|inscription" backend/src/domains/01-identites/identites.routes.js | head -20
```

Si `inscription_id` n'est pas retourné, adapter la requête ou utiliser un endpoint alternatif.

- [ ] **Step 2 : Créer le fichier**

```javascript
'use strict';

var PageEnsDiscipline = {
  _classes: [],
  _page: 1,
  _limite: 20,
  _filtreClasseId: '',
  _filtreType: '',

  async init() {
    await this._chargerClasses();
    this._peuplerFiltres();
    await this.charger();
  },

  async _chargerClasses() {
    try {
      var res = await Api.get('/enseignants/moi/classes');
      // Dédupliquer
      var vues = {};
      this._classes = (res.data || []).filter(function(c) {
        if (vues[c.classe_id]) return false;
        vues[c.classe_id] = true;
        return true;
      });
    } catch (e) { this._classes = []; }
  },

  _peuplerFiltres() {
    var sel = document.getElementById('ens-disc-fil-classe');
    if (sel) {
      sel.innerHTML = '<option value="">Toutes mes classes</option>' +
        this._classes.map(function(c) {
          return '<option value="' + c.classe_id + '">' + c.classe + '</option>';
        }).join('');
    }
  },

  filtrerClasse(classeId) { this._filtreClasseId = classeId; this._page = 1; this.charger(); },
  filtrerType(type)       { this._filtreType = type;         this._page = 1; this.charger(); },

  async charger() {
    var tbody = document.getElementById('tb-ens-sanctions');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:28px;color:var(--g400)">Chargement…</td></tr>';

    try {
      var params = { page: this._page, limite: this._limite };
      if (this._filtreClasseId) params.classe_id = this._filtreClasseId;
      if (this._filtreType)     params.type = this._filtreType;

      var res = await Api.get('/discipline/sanctions', params);
      var sanctions = res.data || [];

      if (!sanctions.length) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:30px;color:var(--g400)">Aucune sanction enregistrée</td></tr>';
        this._renderPagination(null);
        return;
      }

      tbody.innerHTML = sanctions.map(function(s) {
        var typeLabel = {
          avertissement_oral:   'Avert. oral',
          avertissement_ecrit:  'Avert. écrit',
          retenue:              'Retenue',
          renvoi_temporaire:    'Renvoi temp.',
          conseil_discipline:   'Conseil disc.',
          exclusion_definitive: 'Exclusion déf.',
        }[s.type] || s.type;

        return '<tr>' +
          '<td class="nc">' + (s.eleve_prenom || '') + ' ' + (s.eleve_nom || '') + '</td>' +
          '<td><span class="badge bp">' + (s.classe || '—') + '</span></td>' +
          '<td><span class="badge ' + (s.type === 'renvoi_temporaire' || s.type === 'exclusion_definitive' ? 'bd' : 'bw') + '">' + typeLabel + '</span></td>' +
          '<td style="font-family:\'Space Mono\',monospace;font-size:11.5px">' + (s.date_prononcee || '—') + '</td>' +
          '<td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--g500)">' + (s.motif || '—') + '</td>' +
          '<td style="text-align:center">' + (s.notif_parent_envoyee ? '<span class="badge bs">📱 Oui</span>' : '<span class="badge bd">Non</span>') + '</td>' +
        '</tr>';
      }).join('');

      this._renderPagination(res.meta);

    } catch (e) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:30px;color:var(--rouge)">' + (e.message || 'Erreur') + '</td></tr>';
    }
  },

  _renderPagination(meta) {
    var pag = document.getElementById('pag-ens-disc');
    if (!pag) return;
    if (!meta || meta.total <= this._limite) { pag.innerHTML = ''; return; }
    var debut = ((meta.page - 1) * meta.limite) + 1;
    var fin = Math.min(meta.page * meta.limite, meta.total);
    pag.innerHTML =
      '<span style="font-size:12px;color:var(--g500)"><b>' + debut + '–' + fin + '</b> / <b>' + meta.total + '</b></span>' +
      '<div style="display:flex;gap:6px">' +
        '<button class="btn btn-l btn-sm" ' + (meta.page <= 1 ? 'disabled' : 'onclick="PageEnsDiscipline._page--;PageEnsDiscipline.charger()"') + '>← Préc.</button>' +
        '<button class="btn btn-p btn-sm" ' + (meta.page >= meta.pages ? 'disabled' : 'onclick="PageEnsDiscipline._page++;PageEnsDiscipline.charger()"') + '>Suiv. →</button>' +
      '</div>';
  },

  // ── Modal création sanction ────────────────────────────────────────
  async ouvrirModal() {
    // Peupler le select classe dans le modal
    var sel = document.getElementById('disc-classe');
    if (sel) {
      sel.innerHTML = '<option value="">— Choisir une classe —</option>' +
        this._classes.map(function(c) {
          return '<option value="' + c.classe_id + '">' + c.classe + '</option>';
        }).join('');
    }
    // Reset élève
    var selEl = document.getElementById('disc-eleve');
    if (selEl) { selEl.innerHTML = '<option value="">— Sélectionnez d\'abord une classe —</option>'; selEl.disabled = true; }

    // Reset champs
    ['disc-motif','disc-type','disc-date'].forEach(function(id) {
      var el = document.getElementById(id);
      if (el) el.value = '';
    });

    openModal('m-ens-discipline');
  },

  async chargerElevesClasse(classeId) {
    var selEl = document.getElementById('disc-eleve');
    if (!selEl) return;
    if (!classeId) { selEl.disabled = true; selEl.innerHTML = '<option value="">— Sélectionnez d\'abord une classe —</option>'; return; }

    selEl.innerHTML = '<option value="">Chargement…</option>';
    selEl.disabled = true;

    try {
      var res = await Api.get('/classes/' + classeId + '/eleves');
      var eleves = res.data || [];
      if (!eleves.length) {
        selEl.innerHTML = '<option value="">Aucun élève dans cette classe</option>';
        return;
      }
      selEl.innerHTML = '<option value="">— Choisir un élève —</option>' +
        eleves.map(function(el) {
          // inscription_id est nécessaire pour POST /discipline/sanctions
          return '<option value="' + (el.inscription_id || el.id) + '">' + el.nom + ' ' + el.prenom + '</option>';
        }).join('');
      selEl.disabled = false;
    } catch (e) {
      selEl.innerHTML = '<option value="">Erreur de chargement</option>';
    }
  },

  async creerSanction() {
    var inscriptionId = document.getElementById('disc-eleve')?.value;
    var type  = document.getElementById('disc-type')?.value;
    var motif = document.getElementById('disc-motif')?.value?.trim();
    var date  = document.getElementById('disc-date')?.value;

    if (!inscriptionId) return toast('Sélectionnez un élève', 'w');
    if (!type)          return toast('Sélectionnez un type de sanction', 'w');
    if (!motif || motif.length < 5) return toast('Le motif doit faire au moins 5 caractères', 'w');

    var btn = document.getElementById('btn-disc-creer');
    if (btn) { btn.disabled = true; btn.textContent = 'Enregistrement…'; }

    try {
      var payload = { inscription_id: inscriptionId, type, motif };
      if (date) payload.date_prononcee = date;

      await Api.post('/discipline/sanctions', payload);
      closeModal('m-ens-discipline');
      toast('Sanction enregistrée ✓ — parent notifié 📱', 's');
      await this.charger();
    } catch (e) {
      toast(e.message || 'Erreur lors de l\'enregistrement', 'e');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Enregistrer la sanction'; }
    }
  },

  init: function() { PageEnsDiscipline._init(); },
  _init: async function() { await PageEnsDiscipline.init(); },
};

PAGE_HOOKS['ens-discipline'] = function() { PageEnsDiscipline.init(); };
```

- [ ] **Step 3 : Commit**

```bash
git add dashboard/js/pages/ens-discipline.js
git commit -m "feat(dashboard): ens-discipline.js — liste sanctions + modal création"
```

---

## Chunk 4 : CSS additionnel + intégration finale

### Task 11 : Vérifier et compléter le CSS

**Files:**
- Modify (if needed): `dashboard/css/style.css`

- [ ] **Step 1 : Vérifier les classes CSS nécessaires**

```bash
# Vérifier les classes du portail enseignant présentes dans style.css
grep -c "\.mo\b\|\.md\b\|\.md-h\|\.md-b\|\.md-f\|\.fg\b\|\.fl\b\|\.fi\b\|\.btn\b\|\.btn-p\|\.btn-l\|\.btn-sm\|\.edt-grid\|\.edt-slot\|\.badge\|\.bw\b\|\.bo\b\|\.bp\b" dashboard/css/style.css
```

- [ ] **Step 2 : Si des classes manquent, les ajouter à la fin de `style.css`**

Classes qui pourraient manquer (à vérifier) :

```css
/* ── Badges supplémentaires (si absents) ── */
.bw { background: var(--warning-lt); color: var(--warning); border: 1px solid #FAD7A0; }
.bo { background: var(--orange-lt); color: var(--orange-dk); border: 1px solid #F5CBA7; }
.bp { background: #EBF5FB; color: var(--bleu); border: 1px solid #AED6F1; }
.bn { background: var(--g100); color: var(--g500); border: 1px solid var(--g200); }
```

- [ ] **Step 3 : Commit si modifications**

```bash
git add dashboard/css/style.css
git commit -m "fix(dashboard): ajout badges CSS manquants pour le portail enseignant"
```

---

### Task 12 : Test d'intégration manuel

- [ ] **Step 1 : Démarrer le serveur de dev**

```bash
# Terminal 1 — Backend
cd backend && npm run dev
# → API disponible sur http://localhost:3010/api/v1

# Terminal 2 — Dashboard
npx serve "/Users/A.BEYE/SAFTH NOTE/ecolemanager/dashboard" -l 3001
# → Dashboard sur http://localhost:3001
```

- [ ] **Step 2 : Vérifier auth.js — redirection enseignant**

1. Ouvrir http://localhost:3001/login.html
2. Se connecter avec un compte enseignant
3. ✅ Vérifier la redirection vers `enseignant.html`
4. Se connecter avec un compte directeur
5. ✅ Vérifier la redirection vers `index.html`

- [ ] **Step 3 : Tester le tableau de bord**

1. Ouvrir `enseignant.html` (connecté en enseignant)
2. ✅ 3 KPI chargés (classes, élèves, évals à saisir)
3. ✅ Widget "Appels à faire aujourd'hui" affiché
4. ✅ Widget "Notes en attente" affiché

- [ ] **Step 4 : Tester "Mes classes"**

1. Cliquer "Mes classes" dans la sidebar
2. ✅ Grille de cartes avec nom de classe, matière, effectif
3. ✅ Bouton "Notes" → redirige vers "Mes notes" avec filtre classe
4. ✅ Bouton "Appel" → redirige vers "Faire l'appel"

- [ ] **Step 5 : Tester "Mon EDT"**

1. Cliquer "Mon EDT"
2. ✅ Grille hebdomadaire affichée avec couleurs par matière

- [ ] **Step 6 : Tester "Faire l'appel"**

1. Cliquer "Faire l'appel"
2. ✅ Créneaux du jour affichés
3. Cliquer "Faire l'appel →" sur un créneau
4. ✅ Grille d'appel avec les élèves
5. Cocher quelques absences
6. ✅ Bouton "Soumettre" → toast succès + retour à la liste
7. ✅ Parents notifiés (vérifier dans les logs backend)

- [ ] **Step 7 : Tester "Mes notes"**

1. Cliquer "Mes notes"
2. ✅ Liste des évaluations
3. Cliquer "+ Nouvelle évaluation"
4. ✅ Modal avec select classe → matières filtrées
5. Créer une évaluation → ✅ toast succès
6. Cliquer "Saisir" sur une évaluation
7. ✅ Grille de notes avec élèves
8. Saisir quelques notes → "Enregistrer" → ✅ toast
9. Cliquer "Publier" → ✅ confirmation + toast parents notifiés

- [ ] **Step 8 : Tester "Discipline"**

1. Cliquer "Discipline"
2. ✅ Tableau des sanctions (vide si premier test)
3. Cliquer "+ Signaler un incident"
4. ✅ Modal : sélectionner classe → élèves chargés
5. Remplir type + motif → "Enregistrer"
6. ✅ Toast succès + sanction dans le tableau

- [ ] **Step 9 : Commit final**

```bash
git add -A
git commit -m "feat(dashboard): portail enseignant SP2 — 6 pages complètes et fonctionnelles"
```

---

## Résumé des fichiers créés / modifiés

| Fichier | Lignes estimées | Statut |
|---------|-----------------|--------|
| `dashboard/enseignant.html` | ~180 | Créer |
| `dashboard/js/ens-router.js` | ~30 | Créer |
| `dashboard/js/ens-app.js` | ~40 | Créer |
| `dashboard/js/pages/ens-dashboard.js` | ~110 | Créer |
| `dashboard/js/pages/ens-classes.js` | ~70 | Créer |
| `dashboard/js/pages/ens-edt.js` | ~75 | Créer |
| `dashboard/js/pages/ens-appel.js` | ~170 | Créer |
| `dashboard/js/pages/ens-notes.js` | ~250 | Créer |
| `dashboard/js/pages/ens-discipline.js` | ~180 | Créer |
| `dashboard/js/auth.js` | +10 lignes | Modifier |
| `dashboard/css/style.css` | +10 lignes | Modifier si manquant |

**Total : ~1 100 lignes de code vanilla JS/HTML**

---

## Points de vigilance

1. **Format `roles` dans la réponse auth** : Vérifier si c'est `utilisateur.role` (string) ou `utilisateur.roles` (array) — adapter `auth.js` en conséquence.

2. **`inscription_id` dans `/classes/:id/eleves`** : Nécessaire pour `POST /discipline/sanctions`. Si absent de la réponse, ajouter le champ dans l'endpoint backend.

3. **Filtre enseignant sur `/evaluations`** : Vérifier que l'endpoint filtre bien par enseignant via JWT (sinon un enseignant verrait toutes les évals de l'établissement).

4. **Jour de la semaine — mapping** : Le backend utilise `jour_semaine` 1=Lun…6=Sam. JS `getDay()` retourne 0=Dim,1=Lun…6=Sam. La conversion directe fonctionne sauf pour le dimanche (0 côté JS, pas de cours côté backend).

5. **`creneau_id` vs `emploi_du_temps_id`** : L'API `/appels` attend `emploi_du_temps_id`. Le champ dans la réponse de `/enseignants/moi/edt` est `creneau_id`. Vérifier la correspondance (normalement c'est le même identifiant).
