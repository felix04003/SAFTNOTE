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

  // Initialiser les notifications
  Notifs.init();

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
