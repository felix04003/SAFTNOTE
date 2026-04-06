# Architecture — Dashboard

## Les 3 portails

| Portail | Fichier HTML | App JS | Router JS | Pages |
|---------|-------------|--------|-----------|-------|
| Admin | `index.html` | `app.js` | `router.js` | `pages/*.js` (sans préfixe) |
| Enseignant | `enseignant.html` | `ens-app.js` | `ens-router.js` | `pages/ens-*.js` |
| Parent | `parent.html` | `par-app.js` | `par-router.js` | `pages/par-*.js` |
| Login parent | `parent-login.html` | _(inline)_ | — | — |

## Routing hash

La navigation se fait via `window.location.hash`. Chaque portail a son router :

```javascript
// Exemple ens-router.js
var EnsRouter = {
  init: function() {
    window.addEventListener('hashchange', EnsRouter.route);
    EnsRouter.route();
  },
  route: function() {
    var hash = window.location.hash || '#ens-dashboard';
    // switch sur hash → appel de la page correspondante
  }
};
```

## Convention ES5 OBLIGATOIRE

**Tout le JavaScript du dashboard doit être ES5.** Raison : compatibilité navigateurs anciens en Afrique de l'Ouest.

```javascript
// ✅ Correct — ES5
var PageExample = {
  init: function() { ... },
  charger: function() { ... },
  render: function(data) { ... }
};

// ❌ Interdit
const PageExample = {
  init: () => { ... },    // arrow function
  async charger() { ... } // méthode async ES6
};
```

Règles ES5 :
- `var` uniquement (pas `const`/`let`)
- Pas d'arrow functions `() =>`
- Pas de template literals `` ` ``
- Pas de destructuring
- Pas de classes ES6
- Pas de `async`/`await` — utiliser `.then().catch()`
- Zero-padding : `('0' + n).slice(-2)` (pas `.padStart()`)
- Dates : `getFullYear()`, `getMonth()`, `getDate()` (pas `toISOString()` — décalage UTC)

## Pattern page JS

```javascript
var PageNom = {
  // State
  _data: null,

  // Appelé par le router à chaque navigation vers cette page
  init: function() {
    PageNom._charger();
  },

  _charger: function() {
    Api.get('/route').then(function(res) {
      PageNom._data = res.data;
      PageNom._render();
    }).catch(function(err) {
      console.warn('PageNom: erreur chargement', err.message);
    });
  },

  _render: function() {
    var parts = [];
    // Construire le HTML dans parts[], jamais += dans une boucle
    parts.push('<div>...</div>');
    document.getElementById('contenu').innerHTML = parts.join('');
  }
};
```

## API client

```javascript
// dashboard/js/api.js — fonctions globales
Api.get('/route')                    // GET → Promise
Api.post('/route', body)             // POST → Promise
Api.put('/route', body)              // PUT → Promise
Api.delete('/route')                 // DELETE → Promise

// Toutes les réponses : { succes: true, data: ... } ou { succes: false, erreur: ... }
// La base URL est dans dashboard/js/config.js → CONFIG.API_BASE
```

## Inline onclick — piège JSON.stringify

```javascript
// ❌ Problème : JSON.stringify casse les onclick avec guillemets
parts.push('<button onclick="ouvrir(' + JSON.stringify(obj) + ')">');

// ✅ Solution : stocker dans une map, passer seulement l'id
var _map = {};
_map[obj.id] = obj;
parts.push('<button onclick="ouvrir(\'' + obj.id + '\')">');
function ouvrir(id) { var obj = _map[id]; ... }
```

## Structure fichiers dashboard

```
dashboard/
  index.html              ← portail admin
  enseignant.html         ← portail enseignant
  parent.html             ← portail parent
  parent-login.html       ← login OTP SMS
  css/
    style.css             ← styles globaux (tous les portails)
  js/
    config.js             ← CONFIG.API_BASE, CONFIG.VERSION
    api.js                ← Api.get/post/put/delete
    auth.js               ← vérif token + redirection rôle
    app.js                ← init portail admin
    router.js             ← routing admin
    ens-app.js            ← init portail enseignant
    ens-router.js         ← routing enseignant
    par-app.js            ← init portail parent
    par-router.js         ← routing parent
    ui.js                 ← helpers UI (modals, toasts, loaders)
    data-mock.js          ← données mock pour dev offline
    pages/
      *.js                ← pages admin (absences, bulletins, classes…)
      ens-*.js            ← pages enseignant
      par-*.js            ← pages parent
  .claude/
    launch.json           ← config serveur preview (port 3001, npx serve)
```
