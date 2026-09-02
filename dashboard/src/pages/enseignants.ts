// @ts-nocheck
import { Api } from '../api';
import { escapeHtml, init2, toast, openModal, closeModal } from '../ui';
import { PAGE_HOOKS } from '../router';

export const PageEnseignants: any = {
  data: [],

  async charger() {
    try {
      var res = await Api.get('/enseignants');
      this.data = res.data;
      this.renderTable(res.data);
      return true;
    } catch (e) {
      console.error('PageEnseignants.charger —', e.message);
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
      telephone: telephone.replace(/\s/g, ''),
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
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--g400);padding:30px">Aucun enseignant trouvé</td></tr>';
      return;
    }

    tbody.innerHTML = enseignants.map(function(e) {
      var nom = escapeHtml((e.prenom || '') + ' ' + (e.nom || ''));
      var nomForAttr = nom.replace(/'/g, '');
      return '<tr>' +
        '<td class="nc" style="display:flex;align-items:center;gap:9px"><div class="av" style="background:var(--bleu)">' + init2(nom) + '</div>' + nom + '</td>' +
        '<td><span class="badge bo">' + escapeHtml(e.specialite || '—') + '</span></td>' +
        '<td style="font-size:12px;color:var(--g500)">' + escapeHtml(e.telephone || '—') + '</td>' +
        '<td style="font-size:12px;color:var(--g500)">' + escapeHtml(e.email || '—') + '</td>' +
        '<td><span class="badge bn">' + escapeHtml(e.type_contrat || 'titulaire') + '</span></td>' +
        '<td><span class="badge bs">Actif</span></td>' +
        '<td style="display:flex;gap:6px">' +
          '<button class="btn btn-l btn-sm" onclick="toast(\'Fiche à venir\')">Voir</button>' +
          '<button class="btn btn-p btn-sm" onclick="PageAffectations.ouvrir(\'' + escapeHtml(e.id) + '\',\'' + nomForAttr + '\')">📋 Affecter</button>' +
        '</td>' +
      '</tr>';
    }).join('');
  },

  init: function() { this.charger(); }
};


// ─────────────────────────────────────────────────────────────────
// PageAffectations — géré depuis la page Enseignants
// ─────────────────────────────────────────────────────────────────
export const PageAffectations: any = {
  enseignantId:  null,
  enseignantNom: null,

  async ouvrir(id, nom) {
    this.enseignantId  = id;
    this.enseignantNom = nom;

    var titre = document.getElementById('m-aff-titre');
    if (titre) titre.textContent = 'Affectations — ' + nom;

    openModal('m-affectations');
    await Promise.all([this.chargerClasses(), this.chargerMatieres(), this.chargerAffectations()]);
  },

  async chargerClasses() {
    var sel = document.getElementById('m-aff-classe');
    if (!sel) return;
    try {
      var res = await Api.get('/classes');
      var classes = res.data || [];
      if (!classes.length) {
        sel.innerHTML = '<option value="">Aucune classe</option>';
        return;
      }
      sel.innerHTML = '<option value="">— Choisir —</option>' +
        classes.map(function(c) {
          return '<option value="' + c.id + '">' + (c.niveau_nom || c.niveau || '') + ' ' + c.nom + '</option>';
        }).join('');
    } catch (e) {
      sel.innerHTML = '<option value="">Erreur chargement classes</option>';
    }
  },

  async chargerMatieres() {
    var sel = document.getElementById('m-aff-matiere');
    if (!sel) return;
    try {
      var res = await Api.get('/configs/matieres', { actif_seulement: 'true' });
      var matieres = res.data || [];
      if (!matieres.length) {
        sel.innerHTML = '<option value="">Aucune matière — créez-en dans Paramètres</option>';
        return;
      }
      sel.innerHTML = '<option value="">— Choisir —</option>' +
        matieres.map(function(m) {
          return '<option value="' + m.id + '">' + m.nom + '</option>';
        }).join('');
    } catch (e) {
      sel.innerHTML = '<option value="">Erreur chargement matières</option>';
    }
  },

  async chargerAffectations() {
    var liste = document.getElementById('m-aff-liste');
    var label = document.getElementById('m-aff-annee-label');
    if (!liste) return;

    liste.innerHTML = '<div style="color:var(--g400);font-size:13px;text-align:center;padding:16px">Chargement…</div>';

    try {
      var res = await Api.get('/enseignants/' + this.enseignantId + '/affectations');
      var data = res.data;
      if (label) label.textContent = 'Affectations actuelles (' + (data.annee || '') + ')';

      var aff = data.affectations || [];
      if (!aff.length) {
        liste.innerHTML = '<div style="color:var(--g400);font-size:13px;text-align:center;padding:16px">(Aucune affectation pour le moment)</div>';
        return;
      }

      liste.innerHTML = aff.map(function(a) {
        return '<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--g100)">' +
          '<span style="font-size:13px">• <strong>' + escapeHtml(a.matiere) + '</strong> · ' + escapeHtml(a.niveau || '') + ' ' + escapeHtml(a.classe) + (a.est_titulaire ? ' <span class="badge bs" style="font-size:10px">Titulaire</span>' : '') + '</span>' +
          '<button class="btn btn-d btn-sm" onclick="PageAffectations.supprimer(\'' + escapeHtml(a.id) + '\')">🗑️</button>' +
        '</div>';
      }).join('');
    } catch (e) {
      liste.innerHTML = '<div style="color:var(--rouge);font-size:13px;text-align:center;padding:16px">Impossible de charger les affectations</div>';
    }
  },

  async ajouter() {
    var classeId  = document.getElementById('m-aff-classe')?.value;
    var matiereId = document.getElementById('m-aff-matiere')?.value;
    var titulaire = document.getElementById('m-aff-titulaire')?.checked;

    if (!classeId)  return toast('Veuillez sélectionner une classe', 'w');
    if (!matiereId) return toast('Veuillez sélectionner une matière', 'w');

    var btn = document.getElementById('btn-ajouter-aff');
    if (btn) { btn.disabled = true; btn.textContent = 'Ajout…'; }

    try {
      await Api.post('/affectations', {
        enseignant_id: this.enseignantId,
        classe_id:     classeId,
        matiere_id:    matiereId,
        est_titulaire: !!titulaire,
      });
      toast('Affectation ajoutée ✓', 's');
      document.getElementById('m-aff-classe').value = '';
      document.getElementById('m-aff-matiere').value = '';
      var cb = document.getElementById('m-aff-titulaire'); if (cb) cb.checked = true;
      await this.chargerAffectations();
    } catch (e) {
      toast('Erreur : ' + (e.message || 'Ajout échoué'), 'd');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = "+ Ajouter l'affectation"; }
    }
  },

  async supprimer(affectationId) {
    if (!confirm('Supprimer cette affectation ?')) return;
    try {
      await Api.del('/affectations/' + affectationId);
      toast('Affectation supprimée', 's');
      await this.chargerAffectations();
    } catch (e) {
      toast('Erreur : ' + (e.message || 'Suppression échouée'), 'd');
    }
  },
};

(window as any).PageEnseignants = PageEnseignants;
(window as any).PageAffectations = PageAffectations;
PAGE_HOOKS['enseignants'] = () => PageEnseignants.init();
PAGE_HOOKS['affectations'] = () => PageAffectations.init();
