# Portail Parents — Plan d'implémentation

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Créer le portail web parent (login OTP SMS + 4 pages : dashboard, notes, absences, bulletins) branché sur les APIs backend déjà existantes.

**Architecture:** Même pattern que `enseignant.html` — fichiers `par-*.js`, routing hash via `par-router.js`, `par-app.js` gère l'auth et le sélecteur multi-enfant. Page de login dédiée `parent-login.html` avec flow OTP 2 étapes. Zéro modification backend.

**Tech Stack:** HTML/CSS/JS vanilla (ES2017+, async/await), réutilise `js/api.js`, `js/auth.js`, `js/ui.js`, `js/config.js`.

**Spec :** `docs/superpowers/specs/2026-03-29-portail-parents-design.md`

---

## Carte des fichiers

| Fichier | Action | Rôle |
|---------|--------|------|
| `dashboard/parent-login.html` | Créer | Login OTP 2 étapes (téléphone → code SMS) |
| `dashboard/parent.html` | Créer | Portail 4 pages + sidebar + sélecteur enfant |
| `dashboard/js/par-router.js` | Créer | Routing hash pour le portail parent |
| `dashboard/js/par-app.js` | Créer | Init, auth check, sélecteur d'enfant, helpers |
| `dashboard/js/pages/par-dashboard.js` | Créer | KPI + dernières notes + absences récentes |
| `dashboard/js/pages/par-notes.js` | Créer | Notes par matière, filtrables par période |
| `dashboard/js/pages/par-absences.js` | Créer | Récap + liste absences/retards |
| `dashboard/js/pages/par-bulletins.js` | Créer | Bulletins trimestriels avec moyennes matières |
| `dashboard/js/auth.js` | Modifier | Ajouter redirection `parent.html` si `role === 'parent'` |

---

## Chunk 1 : Login OTP + auth redirect

### Task 1 : Modifier `auth.js` — redirection parent

**Files:**
- Modify: `dashboard/js/auth.js`

- [ ] **Step 1 : Lire le fichier actuel**

```bash
cat dashboard/js/auth.js
```

Repérer la ligne `window.location.href = (role === 'enseignant') ? 'enseignant.html' : 'index.html';`

- [ ] **Step 2 : Modifier la redirection pour inclure le rôle parent**

Remplacer :
```javascript
window.location.href = (role === 'enseignant') ? 'enseignant.html' : 'index.html';
```

Par :
```javascript
var dest = 'index.html';
if (role === 'enseignant') dest = 'enseignant.html';
else if (role === 'parent') dest = 'parent.html';
window.location.href = dest;
```

- [ ] **Step 3 : Commit**

```bash
git add dashboard/js/auth.js
git commit -m "feat(dashboard): auth.js — redirection parent.html si role=parent"
```

---

### Task 2 : Créer `parent-login.html`

**Files:**
- Create: `dashboard/parent-login.html`

**Flow :** Étape 1 (téléphone + code établissement) → `POST /auth/otp/demander` → Étape 2 (6 chiffres OTP) → `POST /auth/otp/valider` → redirect `parent.html`.

- [ ] **Step 1 : Créer le fichier**

```html
<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>EcoleManager — Espace Parents</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700;800&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="css/style.css">
<style>
.login-wrap { min-height:100vh; display:flex; align-items:center; justify-content:center; background:var(--g50,#f8fafc); }
.login-box  { width:360px; background:white; border-radius:12px; box-shadow:0 4px 24px rgba(0,0,0,.1); overflow:hidden; }
.login-head { background:#2d6a4f; padding:28px; text-align:center; color:white; }
.login-head .lh-app  { font-size:20px; font-weight:800; }
.login-head .lh-sub  { font-size:12px; opacity:.7; margin-top:4px; }
.login-body { padding:24px; }
.otp-inputs { display:flex; gap:8px; justify-content:center; margin:16px 0; }
.otp-inputs input { width:42px; height:52px; text-align:center; font-size:22px; font-weight:800; border:2px solid var(--g200,#e2e8f0); border-radius:8px; color:#2d6a4f; outline:none; }
.otp-inputs input:focus { border-color:#2d6a4f; }
.btn-otp { background:#2d6a4f; color:white; border:none; width:100%; padding:12px; border-radius:8px; font-size:14px; font-weight:700; cursor:pointer; font-family:inherit; }
.btn-otp:disabled { opacity:.6; cursor:not-allowed; }
.login-link { text-align:center; margin-top:14px; font-size:12px; color:var(--g400,#94a3b8); }
.login-link a { color:#2d6a4f; text-decoration:none; }
.login-error { background:#fef2f2; color:#b91c1c; border:1px solid #fecaca; border-radius:6px; padding:10px 12px; font-size:12px; margin-bottom:12px; display:none; }
.resend-wrap { text-align:center; margin-top:12px; font-size:12px; color:var(--g400,#94a3b8); }
.resend-wrap a { color:#2d6a4f; cursor:pointer; }
</style>
</head>
<body>

<div class="login-wrap">
  <div class="login-box">
    <div class="login-head">
      <div class="lh-app">EcoleManager</div>
      <div class="lh-sub">Espace Parents</div>
    </div>
    <div class="login-body">

      <!-- ÉTAPE 1 : téléphone + code établissement -->
      <div id="etape1">
        <div style="font-size:14px;font-weight:700;color:#2d6a4f;margin-bottom:16px;text-align:center">Connexion par SMS</div>
        <div class="login-error" id="err1"></div>
        <div class="fg" style="margin-bottom:12px">
          <label class="fl" style="font-size:12px;font-weight:600;color:#374151;display:block;margin-bottom:4px">Numéro de téléphone *</label>
          <input class="fi" type="tel" id="inp-telephone" placeholder="+221 77 XXX XX XX" autocomplete="tel" style="width:100%;box-sizing:border-box">
        </div>
        <div class="fg" style="margin-bottom:20px">
          <label class="fl" style="font-size:12px;font-weight:600;color:#374151;display:block;margin-bottom:4px">Code établissement *</label>
          <input class="fi" type="text" id="inp-etab-code" placeholder="ex : PMS001" autocomplete="off" style="width:100%;box-sizing:border-box;text-transform:uppercase">
        </div>
        <button class="btn-otp" id="btn-demander" onclick="demanderOTP()">📱 Recevoir le code SMS</button>
        <div class="login-link">Personnel de l'école ? <a href="login.html">Connexion normale →</a></div>
      </div>

      <!-- ÉTAPE 2 : saisie OTP -->
      <div id="etape2" style="display:none">
        <div style="font-size:14px;font-weight:700;color:#2d6a4f;margin-bottom:6px;text-align:center">Code envoyé ✓</div>
        <div id="otp-hint" style="font-size:12px;color:#64748b;text-align:center;margin-bottom:4px"></div>
        <div class="login-error" id="err2"></div>
        <div class="otp-inputs" id="otp-inputs">
          <input type="number" maxlength="1" min="0" max="9" oninput="avancerOTP(this,0)" onkeydown="reculerOTP(event,0)">
          <input type="number" maxlength="1" min="0" max="9" oninput="avancerOTP(this,1)" onkeydown="reculerOTP(event,1)">
          <input type="number" maxlength="1" min="0" max="9" oninput="avancerOTP(this,2)" onkeydown="reculerOTP(event,2)">
          <input type="number" maxlength="1" min="0" max="9" oninput="avancerOTP(this,3)" onkeydown="reculerOTP(event,3)">
          <input type="number" maxlength="1" min="0" max="9" oninput="avancerOTP(this,4)" onkeydown="reculerOTP(event,4)">
          <input type="number" maxlength="1" min="0" max="9" oninput="avancerOTP(this,5)" onkeydown="reculerOTP(event,5)">
        </div>
        <button class="btn-otp" id="btn-valider" onclick="validerOTP()">Connexion →</button>
        <div class="resend-wrap"><span id="resend-msg">Pas reçu ? <a onclick="renvoyerOTP()">Renvoyer</a></span></div>
      </div>

    </div>
  </div>
</div>

<script src="js/config.js"></script>
<script src="js/api.js"></script>
<script>
'use strict';

var _telephone = '';
var _etabCode = '';
var _resendTimer = null;

async function demanderOTP() {
  var tel     = document.getElementById('inp-telephone').value.trim();
  var etab    = document.getElementById('inp-etab-code').value.trim().toUpperCase();
  var errEl   = document.getElementById('err1');
  errEl.style.display = 'none';

  if (!tel)  { afficherErreur('err1', 'Numéro de téléphone requis'); return; }
  if (!etab) { afficherErreur('err1', 'Code établissement requis'); return; }

  var btn = document.getElementById('btn-demander');
  btn.disabled = true; btn.textContent = 'Envoi en cours…';

  try {
    await Api.post('/auth/otp/demander', { telephone: tel, etablissement_code: etab });
    _telephone = tel;
    _etabCode  = etab;

    // Passer à l'étape 2
    document.getElementById('etape1').style.display = 'none';
    document.getElementById('etape2').style.display = '';
    document.getElementById('otp-hint').textContent = 'Code à 6 chiffres envoyé au ' + tel;
    document.getElementById('otp-inputs').querySelectorAll('input')[0].focus();
    demarrerCooldown();
  } catch (e) {
    afficherErreur('err1', e.message || 'Erreur lors de l\'envoi du code');
  } finally {
    btn.disabled = false; btn.textContent = '📱 Recevoir le code SMS';
  }
}

async function validerOTP() {
  var inputs = document.getElementById('otp-inputs').querySelectorAll('input');
  var code   = Array.from(inputs).map(function(i) { return i.value; }).join('');
  if (code.length < 6) { afficherErreur('err2', 'Saisissez les 6 chiffres du code'); return; }

  var btn = document.getElementById('btn-valider');
  btn.disabled = true; btn.textContent = 'Connexion…';

  try {
    var res = await Api.post('/auth/otp/valider', {
      telephone: _telephone,
      code: code,
      etablissement_code: _etabCode,
    });
    localStorage.setItem(CONFIG.TOKEN_KEY, res.data.token);
    localStorage.setItem(CONFIG.USER_KEY, JSON.stringify(res.data.utilisateur));
    window.location.href = 'parent.html';
  } catch (e) {
    afficherErreur('err2', e.message || 'Code incorrect ou expiré');
    inputs.forEach(function(i) { i.value = ''; });
    inputs[0].focus();
  } finally {
    btn.disabled = false; btn.textContent = 'Connexion →';
  }
}

function avancerOTP(input, idx) {
  // Garder uniquement le dernier chiffre saisi
  if (input.value.length > 1) input.value = input.value.slice(-1);
  var inputs = document.getElementById('otp-inputs').querySelectorAll('input');
  if (input.value && idx < 5) inputs[idx + 1].focus();
}

function reculerOTP(e, idx) {
  if (e.key === 'Backspace') {
    var inputs = document.getElementById('otp-inputs').querySelectorAll('input');
    if (!inputs[idx].value && idx > 0) { inputs[idx - 1].value = ''; inputs[idx - 1].focus(); }
  }
}

async function renvoyerOTP() {
  if (_resendTimer) return;
  document.getElementById('err2').style.display = 'none';
  try {
    await Api.post('/auth/otp/demander', { telephone: _telephone, etablissement_code: _etabCode });
    demarrerCooldown();
    document.getElementById('otp-inputs').querySelectorAll('input').forEach(function(i) { i.value = ''; });
    document.getElementById('otp-inputs').querySelectorAll('input')[0].focus();
  } catch (e) {
    afficherErreur('err2', 'Erreur lors du renvoi');
  }
}

function demarrerCooldown() {
  var secs = 60;
  var el   = document.getElementById('resend-msg');
  _resendTimer = setInterval(function() {
    secs--;
    if (secs <= 0) {
      clearInterval(_resendTimer); _resendTimer = null;
      el.innerHTML = 'Pas reçu ? <a onclick="renvoyerOTP()">Renvoyer</a>';
    } else {
      el.textContent = 'Renvoyer dans ' + secs + 's…';
    }
  }, 1000);
}

function afficherErreur(id, msg) {
  var el = document.getElementById(id);
  el.textContent = msg;
  el.style.display = 'block';
}
</script>
</body>
</html>
```

- [ ] **Step 2 : Vérifier que les classes CSS `.fi`, `.fg`, `.fl` existent dans style.css**

```bash
grep -c "\.fi\b\|\.fg\b\|\.fl\b" dashboard/css/style.css
```

Expected : > 0.

- [ ] **Step 3 : Commit**

```bash
git add dashboard/parent-login.html
git commit -m "feat(dashboard): parent-login.html — login OTP SMS 2 étapes"
```

---

## Chunk 2 : Portail — router + app + HTML

### Task 3 : Créer `par-router.js`

**Files:**
- Create: `dashboard/js/par-router.js`

- [ ] **Step 1 : Créer le fichier**

```javascript
'use strict';

var PAR_TITRES = {
  'par-dashboard': 'Tableau de bord',
  'par-notes':     'Notes & résultats',
  'par-absences':  'Absences & retards',
  'par-bulletins': 'Bulletins scolaires',
};

var PAR_HOOKS = {};

function goto(id) {
  document.querySelectorAll('.page').forEach(function(p) { p.classList.remove('active'); });
  var pageEl = document.getElementById('page-' + id);
  if (pageEl) pageEl.classList.add('active');
  document.querySelectorAll('.nav-item').forEach(function(n) {
    n.classList.toggle('actif', n.dataset.page === id);
  });
  var titreEl = document.getElementById('tb-titre');
  if (titreEl) titreEl.textContent = PAR_TITRES[id] || id;
  history.replaceState(null, '', '#' + id);
  if (PAR_HOOKS[id]) PAR_HOOKS[id]();
}

window.addEventListener('hashchange', function() {
  var id = location.hash.slice(1);
  if (id && PAR_TITRES[id]) goto(id);
});
```

- [ ] **Step 2 : Commit**

```bash
git add dashboard/js/par-router.js
git commit -m "feat(dashboard): par-router.js — routing hash portail parent"
```

---

### Task 4 : Créer `par-app.js`

**Files:**
- Create: `dashboard/js/par-app.js`

**Responsabilité :** Auth check, chargement de la liste des enfants, sélecteur d'enfant, helpers `ParApp.enfantId()` et `ParApp.enfantLien()` utilisés par les pages.

- [ ] **Step 1 : Créer le fichier**

```javascript
'use strict';

var ParApp = {
  _enfants: [],          // résultat de GET /parents/moi/enfants
  _enfantActif: null,    // objet enfant courant

  enfantId: function() {
    return ParApp._enfantActif ? ParApp._enfantActif.eleve_utilisateur_id : null;
  },

  enfantLien: function() {
    return ParApp._enfantActif || {};
  },

  _chargerEnfants: async function() {
    try {
      var res = await Api.get('/parents/moi/enfants');
      ParApp._enfants = res.data || [];
    } catch (e) {
      ParApp._enfants = [];
    }
  },

  _activerEnfant: function(id) {
    var enfant = ParApp._enfants.find(function(e) { return e.eleve_utilisateur_id === id; });
    if (!enfant && ParApp._enfants.length) enfant = ParApp._enfants[0];
    ParApp._enfantActif = enfant || null;
    if (enfant) localStorage.setItem('par_enfant_actif', enfant.eleve_utilisateur_id);
  },

  _peuplerSidebar: function() {
    var user = Auth.getUser();
    var nomEl    = document.getElementById('sb-user-nom');
    var roleEl   = document.getElementById('sb-user-role');
    var avatarEl = document.getElementById('sb-user-avatar');
    var etabEl   = document.getElementById('sb-etab-nom');

    if (nomEl)    nomEl.textContent    = (user && user.prenom ? user.prenom + ' ' : '') + (user && user.nom ? user.nom : '');
    if (roleEl)   roleEl.textContent   = 'Parent';
    if (avatarEl) avatarEl.textContent = (user && user.prenom && user.nom) ? (user.prenom[0] + user.nom[0]).toUpperCase() : 'P';
    if (etabEl)   etabEl.textContent   = (user && user.etablissement_nom) ? user.etablissement_nom : 'EcoleManager';
  },

  _peuplerSelecteur: function() {
    var sel = document.getElementById('par-enfant-sel');
    if (!sel) return;

    if (ParApp._enfants.length <= 1) {
      // Masquer le select, afficher juste le nom
      var conteneur = document.getElementById('par-enfant-wrap');
      if (conteneur && ParApp._enfantActif) {
        conteneur.innerHTML =
          '<div style="font-size:9px;opacity:.5;margin-bottom:4px;letter-spacing:.5px;text-transform:uppercase">Mon enfant</div>' +
          '<div style="font-size:11px;font-weight:600">' +
            (ParApp._enfantActif.prenom || '') + ' ' + (ParApp._enfantActif.nom || '') +
          '</div>' +
          '<div style="font-size:9px;opacity:.5">' + (ParApp._enfantActif.classe || '') + '</div>';
      }
      return;
    }

    sel.innerHTML = ParApp._enfants.map(function(e) {
      return '<option value="' + e.eleve_utilisateur_id + '">' +
        (e.prenom || '') + ' ' + (e.nom || '') +
        (e.classe ? ' — ' + e.classe : '') +
      '</option>';
    }).join('');

    if (ParApp._enfantActif) sel.value = ParApp._enfantActif.eleve_utilisateur_id;

    sel.addEventListener('change', function() {
      ParApp._activerEnfant(sel.value);
      // Recharger la page active
      var pageActive = document.querySelector('.page.active');
      if (pageActive) {
        var id = pageActive.id.replace('page-', '');
        if (PAR_HOOKS[id]) PAR_HOOKS[id]();
      }
    });
  },
};

document.addEventListener('DOMContentLoaded', async function() {
  // Auth check
  if (!Auth.requireAuth()) return;
  var user = Auth.getUser();
  var role = (user && user.role) ? user.role.toLowerCase() : '';
  if (role !== 'parent') { window.location.href = 'index.html'; return; }

  // Charger les enfants
  await ParApp._chargerEnfants();
  if (!ParApp._enfants.length) {
    document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;min-height:100vh;font-family:Sora,sans-serif;color:#64748b">Aucun enfant lié à votre compte.</div>';
    return;
  }

  // Activer l'enfant mémorisé ou le premier
  var dernier = localStorage.getItem('par_enfant_actif');
  ParApp._activerEnfant(dernier);

  // Peupler la sidebar
  ParApp._peuplerSidebar();
  ParApp._peuplerSelecteur();

  // Date dans la topbar
  var dateEl = document.getElementById('ph-sous-date');
  if (dateEl) {
    var now = new Date();
    var opts = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    var dateStr = now.toLocaleDateString('fr-FR', opts);
    dateStr = dateStr.charAt(0).toUpperCase() + dateStr.slice(1);
    var etab = (user && user.etablissement_nom) ? user.etablissement_nom : 'EcoleManager';
    dateEl.textContent = etab + ' · ' + dateStr;
  }

  // Bouton déconnexion
  var logoutBtn = document.getElementById('btn-logout');
  if (logoutBtn) logoutBtn.addEventListener('click', function(e) { e.preventDefault(); Auth.logout(); });

  // Routing initial
  var hash = location.hash.slice(1);
  if (hash && PAR_TITRES[hash]) goto(hash);
  else goto('par-dashboard');
});
```

- [ ] **Step 2 : Commit**

```bash
git add dashboard/js/par-app.js
git commit -m "feat(dashboard): par-app.js — init portail parent + sélecteur multi-enfant"
```

---

### Task 5 : Créer `parent.html`

**Files:**
- Create: `dashboard/parent.html`

- [ ] **Step 1 : Créer la structure HTML**

```html
<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>EcoleManager — Espace Parents</title>
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
    <a class="nav-item actif" data-page="par-dashboard" onclick="goto('par-dashboard')"><span class="nav-ico">📊</span>Tableau de bord</a>
    <div class="nav-sec">Mon enfant</div>
    <a class="nav-item" data-page="par-notes"    onclick="goto('par-notes')"   ><span class="nav-ico">📝</span>Notes & résultats</a>
    <a class="nav-item" data-page="par-absences" onclick="goto('par-absences')"><span class="nav-ico">✅</span>Absences</a>
    <a class="nav-item" data-page="par-bulletins" onclick="goto('par-bulletins')"><span class="nav-ico">📄</span>Bulletins</a>
  </nav>
  <div class="sb-user">
    <div class="u-avatar" id="sb-user-avatar">P</div>
    <div style="flex:1">
      <div class="u-name" id="sb-user-nom"></div>
      <div class="u-role" id="sb-user-role">Parent</div>
    </div>
    <a href="#" id="btn-logout" title="Déconnexion" style="color:rgba(255,255,255,.4);font-size:16px;text-decoration:none;padding:4px">🚪</a>
  </div>
</aside>

<!-- Sélecteur d'enfant — affiché sous la sidebar nav si plusieurs enfants -->
<div id="par-enfant-wrap" style="position:fixed;bottom:64px;left:0;width:200px;padding:12px 16px;background:#1a3d5c;border-top:1px solid rgba(255,255,255,.1);z-index:100">
  <div style="font-size:9px;color:rgba(255,255,255,.5);margin-bottom:6px;letter-spacing:.5px;text-transform:uppercase">Enfant actif</div>
  <select id="par-enfant-sel" class="fi" style="width:100%;background:rgba(255,255,255,.1);color:white;border:1px solid rgba(255,255,255,.2);font-size:11px;padding:5px 8px;border-radius:4px"></select>
</div>

<main class="main">
  <header class="topbar">
    <span class="tb-titre" id="tb-titre">Tableau de bord</span>
    <span class="tb-annee" id="tb-annee"></span>
    <div class="tb-notif" title="Notifications">🔔<span class="notif-dot"></span></div>
  </header>

  <div class="content">

    <!-- ═══ PAGE DASHBOARD ═══ -->
    <div class="page active" id="page-par-dashboard">
      <div class="ph">
        <div>
          <div class="ph-titre" id="par-greeting">Bonjour 👋</div>
          <div class="ph-sous" id="ph-sous-date"></div>
        </div>
      </div>
      <div class="sg" style="grid-template-columns:repeat(3,1fr)">
        <div class="sc" style="--c:var(--vert)">
          <div class="sc-ico">📊</div>
          <div class="sc-val" id="par-kpi-moy">—</div>
          <div class="sc-lbl">Moyenne générale</div>
        </div>
        <div class="sc" style="--c:var(--orange)">
          <div class="sc-ico">⚠️</div>
          <div class="sc-val" id="par-kpi-abs">—</div>
          <div class="sc-lbl">Absences (année)</div>
        </div>
        <div class="sc" style="--c:var(--bleu)">
          <div class="sc-ico">🏆</div>
          <div class="sc-val" id="par-kpi-mention">—</div>
          <div class="sc-lbl">Mention</div>
        </div>
      </div>
      <div class="g2">
        <div class="carte">
          <div class="ch"><span>📝</span><span class="ct">Dernières notes publiées</span><a class="ca" onclick="goto('par-notes')">Tout voir →</a></div>
          <div id="par-dernieres-notes" style="padding:12px 18px"></div>
        </div>
        <div class="carte">
          <div class="ch"><span>✅</span><span class="ct">Absences récentes</span><a class="ca" onclick="goto('par-absences')">Tout voir →</a></div>
          <div id="par-recap-absences" style="padding:12px 18px"></div>
        </div>
      </div>
    </div>

    <!-- ═══ PAGE NOTES ═══ -->
    <div class="page" id="page-par-notes">
      <div class="ph">
        <div><div class="ph-titre">Notes & résultats</div><div class="ph-sous" id="par-notes-sous">—</div></div>
      </div>
      <div style="display:flex;gap:10px;margin-bottom:16px">
        <select class="fi" id="par-fil-periode" onchange="PageParNotes.filtrerPeriode(this.value)" style="flex:1">
          <option value="">Toutes les périodes</option>
        </select>
      </div>
      <div id="par-notes-container"></div>
    </div>

    <!-- ═══ PAGE ABSENCES ═══ -->
    <div class="page" id="page-par-absences">
      <div class="ph">
        <div><div class="ph-titre">Absences & retards</div></div>
      </div>
      <div id="par-recap-abs-table" style="margin-bottom:16px"></div>
      <div class="carte">
        <div class="ch"><span>📋</span><span class="ct">Détail des absences</span></div>
        <div class="tw">
          <table>
            <thead><tr>
              <th>Date</th><th>Matière</th><th>Horaire</th><th>Statut</th><th>Justifié</th>
            </tr></thead>
            <tbody id="tb-par-absences"></tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- ═══ PAGE BULLETINS ═══ -->
    <div class="page" id="page-par-bulletins">
      <div class="ph">
        <div><div class="ph-titre">Bulletins scolaires</div><div class="ph-sous" id="par-bulletins-sous">—</div></div>
      </div>
      <div id="par-bulletins-liste"></div>
    </div>

  </div><!-- /.content -->
</main>

<div id="tc" style="position:fixed;bottom:24px;right:24px;z-index:9999;display:flex;flex-direction:column;gap:8px"></div>

<script src="js/config.js"></script>
<script src="js/api.js"></script>
<script src="js/auth.js"></script>
<script src="js/ui.js"></script>
<script src="js/par-router.js"></script>
<script src="js/pages/par-dashboard.js"></script>
<script src="js/pages/par-notes.js"></script>
<script src="js/pages/par-absences.js"></script>
<script src="js/pages/par-bulletins.js"></script>
<script src="js/par-app.js"></script>
</body>
</html>
```

- [ ] **Step 2 : Commit**

```bash
git add dashboard/parent.html
git commit -m "feat(dashboard): parent.html — structure portail parent (4 pages + sidebar + sélecteur enfant)"
```

---

## Chunk 3 : Pages JS — Dashboard + Notes

### Task 6 : Créer `par-dashboard.js`

**Files:**
- Create: `dashboard/js/pages/par-dashboard.js`

**API :** `GET /parents/moi/tableau-de-bord`

- [ ] **Step 1 : Créer le fichier**

```javascript
'use strict';

var PageParDashboard = {

  init: async function() {
    var user = Auth.getUser();
    var greet = document.getElementById('par-greeting');
    if (greet) greet.textContent = 'Bonjour, ' + (user && user.prenom ? user.prenom : '') + ' 👋';

    var enfant = ParApp.enfantLien();
    var nomEnfant = (enfant.prenom || '') + ' ' + (enfant.nom || '');

    try {
      var res = await Api.get('/parents/moi/tableau-de-bord');
      var tdb = (res.data || []).find(function(e) {
        return e.enfant && e.enfant.id === ParApp.enfantId();
      });

      if (!tdb) {
        PageParDashboard._vide();
        return;
      }

      // KPI
      var moy = tdb.moyenne_generale;
      _parSet('par-kpi-moy',     moy ? moy.moyenne_generale : '—');
      _parSet('par-kpi-mention', moy ? (moy.mention || '—')  : '—');

      var abs = tdb.absences || {};
      var totalAbs = (abs.justifiees || 0) + (abs.injustifiees || 0);
      _parSet('par-kpi-abs', totalAbs);

      // Dernières notes
      PageParDashboard._renderDernieresNotes(tdb.dernieres_notes || [], nomEnfant, enfant.peut_voir_notes);

      // Recap absences
      PageParDashboard._renderRecapAbsences(abs, enfant.peut_voir_absences);

    } catch (e) {
      _parSet('par-kpi-moy', '—');
      _parSet('par-kpi-abs', '—');
      _parSet('par-kpi-mention', '—');
    }
  },

  _vide: function() {
    _parSet('par-kpi-moy', '—');
    _parSet('par-kpi-abs', '—');
    _parSet('par-kpi-mention', '—');
    var el = document.getElementById('par-dernieres-notes');
    if (el) el.innerHTML = '<div style="padding:16px;color:var(--g400);font-size:13px;text-align:center">Aucune donnée disponible</div>';
  },

  _renderDernieresNotes: function(notes, nomEnfant, peutVoir) {
    var el = document.getElementById('par-dernieres-notes');
    if (!el) return;

    if (peutVoir === false) {
      el.innerHTML = '<div style="padding:16px;color:var(--g400);font-size:13px;text-align:center">Accès aux notes non autorisé</div>';
      return;
    }
    if (!notes.length) {
      el.innerHTML = '<div style="padding:16px;color:var(--g400);font-size:13px;text-align:center">Aucune note publiée</div>';
      return;
    }

    el.innerHTML = notes.map(function(n) {
      return '<div style="display:flex;align-items:center;justify-content:space-between;padding:9px 0;border-bottom:1px solid var(--g100)">' +
        '<div>' +
          '<div style="font-weight:600;font-size:13px">' + (n.matiere || '—') + '</div>' +
          '<div style="font-size:11.5px;color:var(--g400)">' + (n.type || '') + ' · ' + (n.date_evaluation || '') + '</div>' +
        '</div>' +
        '<span style="font-weight:800;font-size:15px;color:' + _parCn(n.valeur) + '">' + (n.valeur != null ? n.valeur : '—') + '/20</span>' +
      '</div>';
    }).join('');
  },

  _renderRecapAbsences: function(abs, peutVoir) {
    var el = document.getElementById('par-recap-absences');
    if (!el) return;

    if (peutVoir === false) {
      el.innerHTML = '<div style="padding:16px;color:var(--g400);font-size:13px;text-align:center">Accès aux absences non autorisé</div>';
      return;
    }

    var just   = abs.justifiees    || 0;
    var injust = abs.injustifiees  || 0;
    var retard = abs.retards       || 0;

    el.innerHTML =
      '<div style="display:flex;gap:12px;padding:12px 0">' +
        '<div style="flex:1;text-align:center">' +
          '<div style="font-size:22px;font-weight:800;color:var(--orange)">' + injust + '</div>' +
          '<div style="font-size:11px;color:var(--g400)">Injustifiées</div>' +
        '</div>' +
        '<div style="flex:1;text-align:center">' +
          '<div style="font-size:22px;font-weight:800;color:var(--g500)">' + just + '</div>' +
          '<div style="font-size:11px;color:var(--g400)">Justifiées</div>' +
        '</div>' +
        '<div style="flex:1;text-align:center">' +
          '<div style="font-size:22px;font-weight:800;color:var(--bleu)">' + retard + '</div>' +
          '<div style="font-size:11px;color:var(--g400)">Retards</div>' +
        '</div>' +
      '</div>';
  },
};

function _parSet(id, val) {
  var el = document.getElementById(id);
  if (el) el.textContent = (val != null) ? val : '—';
}

function _parCn(val) {
  if (val == null) return 'var(--g500)';
  if (val >= 14)  return 'var(--vert)';
  if (val >= 10)  return 'var(--orange)';
  return 'var(--rouge)';
}

PAR_HOOKS['par-dashboard'] = function() { PageParDashboard.init(); };
```

- [ ] **Step 2 : Commit**

```bash
git add dashboard/js/pages/par-dashboard.js
git commit -m "feat(dashboard): par-dashboard.js — KPI + dernières notes + recap absences"
```

---

### Task 7 : Créer `par-notes.js`

**Files:**
- Create: `dashboard/js/pages/par-notes.js`

**API :** `GET /parents/moi/enfants/:id/notes?periode_id=`

- [ ] **Step 1 : Confirmer la structure de réponse de l'API**

Dans `backend/src/domains/02-acteurs/parents/parents.routes.js`, vérifier la route `GET /parents/moi/enfants/:id/notes` :

```bash
grep -n "par_matiere\|nb_notes\|parMatiere" backend/src/domains/02-acteurs/parents/parents.routes.js
```

Structure retournée : `{ nb_notes: number, par_matiere: [{ matiere, couleur, notes: [...] }] }`

- [ ] **Step 2 : Créer le fichier**

```javascript
'use strict';

var PageParNotes = {
  _periodes:   [],
  _filtrePerid: '',

  init: async function() {
    var enfant = ParApp.enfantLien();
    if (enfant.peut_voir_notes === false) {
      PageParNotes._accesRefuse();
      return;
    }
    await PageParNotes._chargerPeriodes();
    await PageParNotes.charger();
  },

  _chargerPeriodes: async function() {
    try {
      var r = await Api.get('/annees-scolaires/courante');
      PageParNotes._periodes = (r.data && r.data.periodes) || [];
      var sel = document.getElementById('par-fil-periode');
      if (sel) {
        sel.innerHTML = '<option value="">Toutes les périodes</option>' +
          PageParNotes._periodes.map(function(p) {
            return '<option value="' + p.id + '">' + p.libelle + '</option>';
          }).join('');
        if (PageParNotes._filtrePerid) sel.value = PageParNotes._filtrePerid;
      }
    } catch (e) { PageParNotes._periodes = []; }
  },

  filtrerPeriode: function(periodeId) {
    PageParNotes._filtrePerid = periodeId;
    PageParNotes.charger();
  },

  charger: async function() {
    var id = ParApp.enfantId();
    if (!id) return;
    var container = document.getElementById('par-notes-container');
    if (!container) return;
    container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--g400)">Chargement…</div>';

    try {
      var params = {};
      if (PageParNotes._filtrePerid) params.periode_id = PageParNotes._filtrePerid;

      var res  = await Api.get('/parents/moi/enfants/' + id + '/notes', params);
      var data = res.data || {};
      var parMatiere = data.par_matiere || [];

      var enfant = ParApp.enfantLien();
      var sous = document.getElementById('par-notes-sous');
      if (sous) sous.textContent = (enfant.classe || '') + ' · ' + (data.nb_notes || 0) + ' note(s)';

      if (!parMatiere.length) {
        container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--g400)">Aucune note publiée</div>';
        return;
      }

      container.innerHTML = parMatiere.map(function(m) {
        var couleur = m.couleur || '#1a4731';
        return '<div class="carte" style="margin-bottom:16px">' +
          '<div class="ch" style="border-left:3px solid ' + couleur + '">' +
            '<span style="color:' + couleur + ';font-weight:800">' + (m.matiere || '—') + '</span>' +
          '</div>' +
          '<div class="tw">' +
            '<table>' +
              '<thead><tr>' +
                '<th>Type</th><th>Date</th><th>Note</th><th>Moy. classe</th><th>Appréciation</th>' +
              '</tr></thead>' +
              '<tbody>' +
                m.notes.map(function(n) {
                  var valAff = n.est_absent ? '<span class="badge bd">Absent</span>' :
                    (n.valeur != null ? '<span style="font-weight:800;color:' + _parCn(n.valeur) + '">' + n.valeur + '/' + (n.note_max || 20) + '</span>' : '—');
                  return '<tr>' +
                    '<td><span class="badge bo">' + (n.type || '—') + '</span></td>' +
                    '<td style="font-family:\'Space Mono\',monospace;font-size:11.5px">' + (n.date_evaluation || '—') + '</td>' +
                    '<td>' + valAff + '</td>' +
                    '<td style="color:var(--g500);font-size:12px">' + (n.moyenne_classe != null ? n.moyenne_classe + '/20' : '—') + '</td>' +
                    '<td style="color:var(--g500);font-size:12px">' + (n.appreciation || '') + '</td>' +
                  '</tr>';
                }).join('') +
              '</tbody>' +
            '</table>' +
          '</div>' +
        '</div>';
      }).join('');

    } catch (e) {
      if (container) container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--rouge)">' + (e.message || 'Erreur de chargement') + '</div>';
    }
  },

  _accesRefuse: function() {
    var container = document.getElementById('par-notes-container');
    if (container) container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--g400)">Accès aux notes non autorisé pour cet enfant.</div>';
  },

};

PAR_HOOKS['par-notes'] = function() { PageParNotes.init(); };
```

- [ ] **Step 3 : Commit**

```bash
git add dashboard/js/pages/par-notes.js
git commit -m "feat(dashboard): par-notes.js — notes par matière filtrables par période"
```

---

## Chunk 4 : Pages JS — Absences + Bulletins

### Task 8 : Créer `par-absences.js`

**Files:**
- Create: `dashboard/js/pages/par-absences.js`

**API :** `GET /parents/moi/enfants/:id/absences`

- [ ] **Step 1 : Créer le fichier**

```javascript
'use strict';

var PageParAbsences = {

  init: async function() {
    var enfant = ParApp.enfantLien();
    if (enfant.peut_voir_absences === false) {
      PageParAbsences._accesRefuse();
      return;
    }
    await PageParAbsences.charger();
  },

  charger: async function() {
    var id = ParApp.enfantId();
    if (!id) return;
    var tbody = document.getElementById('tb-par-absences');
    if (tbody) tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:28px;color:var(--g400)">Chargement…</td></tr>';

    try {
      // Détail des absences
      var res = await Api.get('/parents/moi/enfants/' + id + '/absences');
      var absences = res.data || [];

      // Totaux depuis le tableau de bord (justifiées / injustifiées / retards)
      var tdbRes = await Api.get('/parents/moi/tableau-de-bord');
      var tdb = (tdbRes.data || []).find(function(e) { return e.enfant && e.enfant.id === id; });
      var abs = (tdb && tdb.absences) || {};
      PageParAbsences._renderRecap(abs);
      PageParAbsences._renderDetail(absences);

    } catch (e) {
      if (tbody) tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:28px;color:var(--rouge)">' + (e.message || 'Erreur') + '</td></tr>';
    }
  },

  _renderRecap: function(abs) {
    var el = document.getElementById('par-recap-abs-table');
    if (!el) return;
    var just   = abs.justifiees   || 0;
    var injust = abs.injustifiees || 0;
    var retard = abs.retards      || 0;
    el.innerHTML =
      '<div class="carte"><div class="ch"><span>📊</span><span class="ct">Récapitulatif total</span></div>' +
      '<div style="display:flex;gap:12px;padding:12px 16px">' +
        '<div style="flex:1;text-align:center"><div style="font-size:22px;font-weight:800;color:var(--orange)">' + injust + '</div><div style="font-size:11px;color:var(--g400)">Injustifiées</div></div>' +
        '<div style="flex:1;text-align:center"><div style="font-size:22px;font-weight:800;color:var(--g500)">'  + just  + '</div><div style="font-size:11px;color:var(--g400)">Justifiées</div></div>' +
        '<div style="flex:1;text-align:center"><div style="font-size:22px;font-weight:800;color:var(--bleu)">'  + retard + '</div><div style="font-size:11px;color:var(--g400)">Retards</div></div>' +
      '</div></div>';
  },

  _renderDetail: function(absences) {
    var tbody = document.getElementById('tb-par-absences');
    if (!tbody) return;

    if (!absences.length) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:28px;color:var(--g400)">Aucune absence enregistrée ✓</td></tr>';
      return;
    }

    var JOURS = ['', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];

    tbody.innerHTML = absences.map(function(a) {
      var jour   = JOURS[a.jour_semaine] || '';
      var statut = { absent: 'Absent', retard: 'Retard', sorti_avant: 'Sorti tôt' }[a.statut] || a.statut;
      var couleur = a.statut === 'absent' ? 'var(--rouge)' : a.statut === 'retard' ? 'var(--orange)' : 'var(--g500)';
      var justif  = a.est_justifie
        ? '<span class="badge bs">✓ Justifié' + (a.motif_justification ? ' — ' + a.motif_justification : '') + '</span>'
        : '<span class="badge bd">Non justifié</span>';

      return '<tr>' +
        '<td style="font-family:\'Space Mono\',monospace;font-size:11.5px">' + (a.date_cours || '—') + '</td>' +
        '<td class="nc">' + (a.matiere || '—') + '</td>' +
        '<td style="font-size:12px;color:var(--g500)">' + (jour ? jour + ' ' : '') + (a.heure_debut || '') + '–' + (a.heure_fin || '') + '</td>' +
        '<td><span style="font-weight:600;color:' + couleur + '">' + statut + (a.minutes_retard ? ' (' + a.minutes_retard + 'min)' : '') + '</span></td>' +
        '<td>' + justif + '</td>' +
      '</tr>';
    }).join('');
  },

  _accesRefuse: function() {
    var tbody = document.getElementById('tb-par-absences');
    if (tbody) tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:28px;color:var(--g400)">Accès aux absences non autorisé pour cet enfant.</td></tr>';
    var recap = document.getElementById('par-recap-abs-table');
    if (recap) recap.innerHTML = '';
  },

};

PAR_HOOKS['par-absences'] = function() { PageParAbsences.init(); };
```

- [ ] **Step 2 : Commit**

```bash
git add dashboard/js/pages/par-absences.js
git commit -m "feat(dashboard): par-absences.js — liste absences/retards avec justification"
```

---

### Task 9 : Créer `par-bulletins.js`

**Files:**
- Create: `dashboard/js/pages/par-bulletins.js`

**API :** `GET /parents/moi/enfants/:id/bulletins`
**Structure retournée :** `{ enfant: {classe, niveau}, annee, bulletins: [{trimestre, periode, moyenne_generale, rang, rang_sur, mention, decision_conseil, appreciation_conseil, nb_absences_justifiees, nb_absences_injustifiees, nb_retards, bulletin_url, matieres: [{matiere, couleur_affichage, moyenne, coefficient, rang_dans_classe, appreciation_enseignant}]}] }`

- [ ] **Step 1 : Créer le fichier**

```javascript
'use strict';

var PageParBulletins = {
  _bulletinsData: null,

  init: async function() {
    var enfant = ParApp.enfantLien();
    if (enfant.peut_voir_bulletins === false) {
      PageParBulletins._accesRefuse();
      return;
    }
    await PageParBulletins.charger();
  },

  charger: async function() {
    var id = ParApp.enfantId();
    if (!id) return;
    var liste = document.getElementById('par-bulletins-liste');
    if (!liste) return;
    liste.innerHTML = '<div style="text-align:center;padding:40px;color:var(--g400)">Chargement…</div>';

    try {
      var res = await Api.get('/parents/moi/enfants/' + id + '/bulletins');
      PageParBulletins._bulletinsData = res.data || {};
      var bulletins = PageParBulletins._bulletinsData.bulletins || [];

      var sous = document.getElementById('par-bulletins-sous');
      if (sous) sous.textContent = (PageParBulletins._bulletinsData.annee || '') + (PageParBulletins._bulletinsData.enfant ? ' · ' + PageParBulletins._bulletinsData.enfant.classe : '');

      if (!bulletins.length) {
        liste.innerHTML = '<div style="text-align:center;padding:40px;color:var(--g400)">Aucun bulletin disponible pour cette année.</div>';
        return;
      }

      liste.innerHTML = bulletins.map(function(b, i) {
        return PageParBulletins._renderBulletin(b, i);
      }).join('');

    } catch (e) {
      liste.innerHTML = '<div style="text-align:center;padding:40px;color:var(--rouge)">' + (e.message || 'Erreur de chargement') + '</div>';
    }
  },

  _renderBulletin: function(b, i) {
    var mention = b.mention || '—';
    var couleurMention = { 'Excellent': 'var(--vert)', 'Très Bien': 'var(--vert)', 'Bien': 'var(--bleu)', 'Assez Bien': 'var(--orange)' }[mention] || 'var(--g500)';

    var matiereRows = (b.matieres || []).map(function(m) {
      var moy = m.moyenne != null ? m.moyenne : '—';
      return '<tr>' +
        '<td class="nc">' + (m.matiere || '—') + '</td>' +
        '<td style="text-align:center">' + (m.coefficient || 1) + '</td>' +
        '<td style="text-align:center;font-weight:700;color:' + _parCn(m.moyenne) + '">' + moy + '</td>' +
        '<td style="text-align:center;font-size:12px;color:var(--g500)">' + (m.rang_dans_classe ? m.rang_dans_classe + 'e' : '—') + '</td>' +
        '<td style="font-size:12px;color:var(--g500)">' + (m.appreciation_enseignant || '') + '</td>' +
      '</tr>';
    }).join('');

    var detailId = 'bul-detail-' + i;

    return '<div class="carte" style="margin-bottom:16px">' +
      // En-tête trimestre
      '<div class="ch" style="cursor:pointer" onclick="document.getElementById(\'' + detailId + '\').style.display = document.getElementById(\'' + detailId + '\').style.display === \'none\' ? \'\' : \'none\'">' +
        '<span>📄</span>' +
        '<span class="ct">' + (b.periode || 'Trimestre ' + b.trimestre) + '</span>' +
        '<span style="font-size:13px;font-weight:800;color:var(--vert)">' + (b.moyenne_generale != null ? b.moyenne_generale + '/20' : '') + '</span>' +
        '<span class="badge" style="background:var(--g100);color:' + couleurMention + ';border:1px solid ' + couleurMention + '">' + mention + '</span>' +
        (b.rang ? '<span style="font-size:12px;color:var(--g400)">' + b.rang + 'e / ' + b.rang_sur + '</span>' : '') +
        '<span style="margin-left:auto;font-size:12px;color:var(--g400)">▾</span>' +
      '</div>' +
      // Détail (masqué par défaut sauf 1er)
      '<div id="' + detailId + '" style="display:' + (i === 0 ? '' : 'none') + '">' +
        // Stats absences
        '<div style="display:flex;gap:16px;padding:12px 18px;background:var(--g50);font-size:12px;color:var(--g500)">' +
          '<span>Absences justif. : <b>' + (b.nb_absences_justifiees || 0) + '</b></span>' +
          '<span>Injustif. : <b style="color:var(--orange)">' + (b.nb_absences_injustifiees || 0) + '</b></span>' +
          '<span>Retards : <b>' + (b.nb_retards || 0) + '</b></span>' +
        '</div>' +
        // Tableau matières
        '<div class="tw"><table>' +
          '<thead><tr><th>Matière</th><th>Coef.</th><th>Moyenne</th><th>Rang</th><th>Appréciation</th></tr></thead>' +
          '<tbody>' + matiereRows + '</tbody>' +
        '</table></div>' +
        // Appréciation conseil + décision
        (b.appreciation_conseil
          ? '<div style="padding:12px 18px;border-top:1px solid var(--g100);font-size:13px;color:var(--g700)"><b>Conseil de classe :</b> ' + b.appreciation_conseil + (b.decision_conseil ? ' — <b>' + b.decision_conseil + '</b>' : '') + '</div>'
          : '') +
        // Lien PDF
        (b.bulletin_url
          ? '<div style="padding:12px 18px;border-top:1px solid var(--g100)"><a href="' + b.bulletin_url + '" target="_blank" class="btn btn-l btn-sm">📥 Télécharger le bulletin PDF</a></div>'
          : '') +
      '</div>' +
    '</div>';
  },

  _accesRefuse: function() {
    var liste = document.getElementById('par-bulletins-liste');
    if (liste) liste.innerHTML = '<div style="text-align:center;padding:40px;color:var(--g400)">Accès aux bulletins non autorisé pour cet enfant.</div>';
  },

};

PAR_HOOKS['par-bulletins'] = function() { PageParBulletins.init(); };
```

- [ ] **Step 2 : Commit**

```bash
git add dashboard/js/pages/par-bulletins.js
git commit -m "feat(dashboard): par-bulletins.js — bulletins trimestriels avec moyennes par matière"
```

---

## Chunk 5 : Push final

### Task 10 : Push + vérification manuelle

- [ ] **Step 1 : Vérifier que tous les fichiers sont commités**

```bash
git status
```

Expected : `nothing to commit, working tree clean`

- [ ] **Step 2 : Push**

```bash
git push origin main
```

- [ ] **Step 3 : Vérification manuelle dans le navigateur**

1. Ouvrir `http://localhost:3001/parent-login.html`
2. Saisir le téléphone d'un parent de test + code établissement → recevoir SMS
3. Saisir le code OTP → redirection vers `parent.html`
4. Vérifier : tableau de bord chargé (KPI, dernières notes, absences)
5. Naviguer vers "Notes" → vérifier les notes par matière
6. Naviguer vers "Absences" → vérifier la liste
7. Naviguer vers "Bulletins" → vérifier (peut être vide si aucun bulletin généré)
8. Si plusieurs enfants : tester le sélecteur d'enfant en sidebar
9. Déconnexion → redirection vers `login.html`
