'use strict';

/**
 * Page Enseignants — liste + création d'un nouvel enseignant.
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
      telephone: telephone,
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
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--g400);padding:30px">Aucun enseignant trouvé</td></tr>';
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
        '<td style="font-size:12px;color:var(--g500)">' + classes + '</td>' +
        '<td style="font-size:12px;color:var(--g500)">' + heures + '</td>' +
        '<td style="font-size:12px;color:var(--g500)">' + tauxNotes + '</td>' +
        '<td style="font-size:12px;color:var(--g500)">' + appels + '</td>' +
        '<td style="font-size:12px;color:var(--g500)">' + derAcces + '</td>' +
        '<td><span class="badge bs">Actif</span></td>' +
      '</tr>';
    }).join('');
  },

  init: function() { this.charger(); }
};

PAGE_HOOKS.enseignants = function() { PageEnseignants.init(); };
