'use strict';

/**
 * Page Paramètres — charge et sauvegarde les infos établissement.
 */
var PageParametres = {
  async charger() {
    try {
      var res = await Api.get('/etablissement');
      this.remplirFormulaire(res.data);
      return true;
    } catch (e) {
      console.warn('PageParametres: fallback statique —', e.message);
      return false;
    }
  },

  remplirFormulaire: function(etab) {
    var set = function(id, val) { var el = document.getElementById(id); if (el && val != null) el.value = val; };
    set('param-nom',   etab.nom);
    set('param-code',  etab.code_officiel);
    set('param-ville', etab.ville);
    set('param-tel',   etab.telephone);
    set('param-email', etab.email);
    set('param-annee', etab.annee_courante || (etab.annee_scolaire && etab.annee_scolaire.libelle));
    // Clés API — ne pas afficher la vraie valeur, juste indiquer si configurée
    if (etab.at_api_key_configured) {
      var atEl = document.getElementById('param-at-key');
      if (atEl) atEl.placeholder = 'Configurée ✓ (laissez vide pour conserver)';
    }
    if (etab.wa_token_configured) {
      var waEl = document.getElementById('param-wa-token');
      if (waEl) waEl.placeholder = 'Configuré ✓ (laissez vide pour conserver)';
    }
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

  init: function() { this.charger(); }
};

PAGE_HOOKS.parametres = function() { PageParametres.init(); };
