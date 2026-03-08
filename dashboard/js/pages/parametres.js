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
    // Remplir les champs du formulaire si on a des données API
    var champs = document.querySelectorAll('#page-parametres .fi, #page-parametres .fs');
    if (!champs.length) return;

    // Nom établissement
    var nomInput = champs[0];
    if (nomInput && etab.nom) nomInput.value = etab.nom;

    // Ville
    var villeInputs = document.querySelectorAll('#page-parametres .fi');
    villeInputs.forEach(function(input) {
      var label = input.previousElementSibling || input.closest('.fg')?.querySelector('.fl');
      if (label && label.textContent.trim() === 'Ville' && etab.ville) {
        input.value = etab.ville;
      }
    });
  },

  sauvegarder: async function() {
    try {
      var champs = document.querySelectorAll('#page-parametres .fi');
      var nom = champs[0] ? champs[0].value : '';

      await Api.put('/etablissement', { nom: nom });
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
