'use strict';

/**
 * Page Paramètres — charge les infos établissement depuis l'API,
 * fallback sur les valeurs statiques du HTML.
 */
var PageParametres = {
  async charger() {
    try {
      var res = await Api.get('/etablissement');
      var etab = res.data;
      this.remplirFormulaire(etab);
      return true;
    } catch (e) {
      console.warn('PageParametres: fallback statique —', e.message);
      return false;
    }
  },

  remplirFormulaire: function(etab) {
    function setVal(id, val) { var el = document.getElementById(id); if (el && val != null) el.value = val; }
    setVal('param-etab-nom',   etab.nom);
    setVal('param-etab-code',  etab.code_officiel);
    setVal('param-etab-ville', etab.ville);
    setVal('param-annee',      etab.annee_courante || (etab.annee_scolaire && etab.annee_scolaire.libelle));
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
    try {
      var nom = (document.getElementById('param-etab-nom') || {}).value || '';
      var ville = (document.getElementById('param-etab-ville') || {}).value || '';
      await Api.put('/etablissement', { nom: nom, ville: ville });
      toast('Modifications sauvegard\u00E9es', 's');
    } catch (e) {
      toast('Erreur : ' + e.message, 'd');
    }
  },

  init: function() {
    this.charger();
  }
};

PAGE_HOOKS.parametres = function() { PageParametres.init(); };
