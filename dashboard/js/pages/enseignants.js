'use strict';

/**
 * Page Enseignants — charge les données depuis l'API,
 * fallback sur les données mock si le backend est indisponible.
 */
var PageEnseignants = {
  data: [],

  async charger() {
    try {
      // L'API enseignants a /enseignants/moi/classes pour l'enseignant connecté.
      // Pour le dashboard admin, on utilise la liste via classes + affectations.
      // Pour l'instant on garde le rendu mock et on le connectera quand
      // un endpoint GET /enseignants (liste admin) sera disponible.
      // On tente quand même un chargement.
      var res = await Api.get('/enseignants');
      this.data = res.data;
      this.renderTable(res.data);
      return true;
    } catch (e) {
      console.warn('PageEnseignants: fallback mock —', e.message);
      return false;
    }
  },

  renderTable: function(enseignants) {
    var tbody = document.getElementById('tb-ens');
    if (!tbody) return;

    if (!enseignants.length) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--g400);padding:30px">Aucun enseignant trouv\u00E9</td></tr>';
      return;
    }

    tbody.innerHTML = enseignants.map(function(e) {
      var nom = (e.prenom || '') + ' ' + (e.nom || '');
      var matiere = e.matieres_assignees || e.matiere || e.specialite || '—';
      var classes = e.classes || (e.nb_classes ? e.nb_classes + ' classe' + (e.nb_classes > 1 ? 's' : '') : '—');
      var heures = e.heures_semaine != null ? e.heures_semaine : '—';
      var tauxNotes = e.taux_notes_saisies || '—';
      var appels = e.appels != null ? e.appels : '—';
      var derAcces = e.dernier_acces || '—';

      return '<tr>' +
        '<td class="nc" style="display:flex;align-items:center;gap:9px"><div class="av" style="background:var(--bleu)">' + init2(nom) + '</div>' + nom + '</td>' +
        '<td><span class="badge bo">' + matiere + '</span></td>' +
        '<td style="font-size:11.5px;color:var(--g500)">' + classes + '</td>' +
        '<td style="font-weight:600">' + heures + (typeof heures === 'number' ? 'h' : '') + '</td>' +
        '<td><span style="font-weight:600;color:var(--g500)">' + tauxNotes + '</span></td>' +
        '<td style="font-family:\'Space Mono\',monospace;font-size:11.5px">' + appels + '</td>' +
        '<td style="font-size:11.5px;color:var(--g400)">' + derAcces + '</td>' +
        '<td><span class="badge bs">Actif</span></td>' +
      '</tr>';
    }).join('');
  },

  init: function() {
    this.charger();
  }
};

// Hook dans le routeur
PAGE_HOOKS.enseignants = function() { PageEnseignants.init(); };
