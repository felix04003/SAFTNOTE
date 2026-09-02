import { Api } from '../api';
import { escapeHtml, init2, toast, openModal, closeModal } from '../ui';
import { PAGE_HOOKS } from '../router';

export const PageEnseignants: any = {
  data: [],

  async charger() {
    try {
      const res = await Api.get('/enseignants');
      this.data = res.data;
      this.renderTable(res.data);
      return true;
    } catch (e: any) {
      console.error('PageEnseignants.charger —', e.message);
      return false;
    }
  },

  async ajouter() {
    const nom        = (document.getElementById('m-ens-nom')       as HTMLInputElement | null)?.value?.trim();
    const prenom     = (document.getElementById('m-ens-prenom')    as HTMLInputElement | null)?.value?.trim();
    const telephone  = (document.getElementById('m-ens-tel')       as HTMLInputElement | null)?.value?.trim();
    const email      = (document.getElementById('m-ens-email')     as HTMLInputElement | null)?.value?.trim();
    const specialite = (document.getElementById('m-ens-specialite') as HTMLInputElement | null)?.value?.trim();
    const contrat    = (document.getElementById('m-ens-contrat')   as HTMLSelectElement | null)?.value;
    const mdp        = (document.getElementById('m-ens-mdp')       as HTMLInputElement | null)?.value?.trim();

    if (!nom || !prenom) return toast('Nom et prénom obligatoires', 'w');
    if (!telephone)      return toast('Numéro de téléphone obligatoire', 'w');

    const payload: Record<string, any> = {
      nom,
      prenom,
      telephone: telephone.replace(/\s/g, ''),
      email: email || undefined,
      specialite: specialite || undefined,
      type_contrat: contrat || 'titulaire',
      mot_de_passe: mdp || undefined,
    };

    const btn = document.getElementById('btn-ajouter-ens') as HTMLButtonElement | null;
    if (btn) { btn.disabled = true; btn.textContent = 'Création…'; }

    try {
      const res = await Api.post('/enseignants', payload);
      closeModal('m-enseignant');
      const mdpInfo = (res.data && res.data.message) || ('Mot de passe provisoire : ' + (mdp || telephone));
      toast('Enseignant créé ✓ — ' + mdpInfo, 's');
      await this.charger();
    } catch (e: any) {
      toast('Erreur : ' + (e.message || 'Création échouée'), 'd');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Créer le compte'; }
    }
  },

  renderTable: function(enseignants: any[]) {
    const tbody = document.getElementById('tb-ens') as HTMLElement | null;
    if (!tbody) return;

    if (!enseignants || !enseignants.length) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--g400);padding:30px">Aucun enseignant trouvé</td></tr>';
      return;
    }

    tbody.innerHTML = enseignants.map(function(e: any) {
      const nom = escapeHtml((e.prenom || '') + ' ' + (e.nom || ''));
      const nomForAttr = nom.replace(/'/g, '');
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

  async ouvrir(id: string, nom: string) {
    this.enseignantId  = id;
    this.enseignantNom = nom;

    const titre = document.getElementById('m-aff-titre') as HTMLElement | null;
    if (titre) titre.textContent = 'Affectations — ' + nom;

    openModal('m-affectations');
    await Promise.all([this.chargerClasses(), this.chargerMatieres(), this.chargerAffectations()]);
  },

  async chargerClasses() {
    const sel = document.getElementById('m-aff-classe') as HTMLSelectElement | null;
    if (!sel) return;
    try {
      const res = await Api.get('/classes');
      const classes = res.data || [];
      if (!classes.length) {
        sel.innerHTML = '<option value="">Aucune classe</option>';
        return;
      }
      sel.innerHTML = '<option value="">— Choisir —</option>' +
        classes.map(function(c: any) {
          return '<option value="' + c.id + '">' + (c.niveau_nom || c.niveau || '') + ' ' + c.nom + '</option>';
        }).join('');
    } catch {
      sel.innerHTML = '<option value="">Erreur chargement classes</option>';
    }
  },

  async chargerMatieres() {
    const sel = document.getElementById('m-aff-matiere') as HTMLSelectElement | null;
    if (!sel) return;
    try {
      const res = await Api.get('/configs/matieres', { actif_seulement: 'true' });
      const matieres = res.data || [];
      if (!matieres.length) {
        sel.innerHTML = '<option value="">Aucune matière — créez-en dans Paramètres</option>';
        return;
      }
      sel.innerHTML = '<option value="">— Choisir —</option>' +
        matieres.map(function(m: any) {
          return '<option value="' + m.id + '">' + m.nom + '</option>';
        }).join('');
    } catch {
      sel.innerHTML = '<option value="">Erreur chargement matières</option>';
    }
  },

  async chargerAffectations() {
    const liste = document.getElementById('m-aff-liste') as HTMLElement | null;
    const label = document.getElementById('m-aff-annee-label') as HTMLElement | null;
    if (!liste) return;

    liste.innerHTML = '<div style="color:var(--g400);font-size:13px;text-align:center;padding:16px">Chargement…</div>';

    try {
      const res = await Api.get('/enseignants/' + this.enseignantId + '/affectations');
      const data = res.data;
      if (label) label.textContent = 'Affectations actuelles (' + (data.annee || '') + ')';

      const aff = data.affectations || [];
      if (!aff.length) {
        liste.innerHTML = '<div style="color:var(--g400);font-size:13px;text-align:center;padding:16px">(Aucune affectation pour le moment)</div>';
        return;
      }

      liste.innerHTML = aff.map(function(a: any) {
        return '<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--g100)">' +
          '<span style="font-size:13px">• <strong>' + escapeHtml(a.matiere) + '</strong> · ' + escapeHtml(a.niveau || '') + ' ' + escapeHtml(a.classe) + (a.est_titulaire ? ' <span class="badge bs" style="font-size:10px">Titulaire</span>' : '') + '</span>' +
          '<button class="btn btn-d btn-sm" onclick="PageAffectations.supprimer(\'' + escapeHtml(a.id) + '\')">🗑️</button>' +
        '</div>';
      }).join('');
    } catch {
      liste.innerHTML = '<div style="color:var(--rouge);font-size:13px;text-align:center;padding:16px">Impossible de charger les affectations</div>';
    }
  },

  async ajouter() {
    const classeId  = (document.getElementById('m-aff-classe')    as HTMLSelectElement | null)?.value;
    const matiereId = (document.getElementById('m-aff-matiere')   as HTMLSelectElement | null)?.value;
    const titulaire = (document.getElementById('m-aff-titulaire') as HTMLInputElement  | null)?.checked;

    if (!classeId)  return toast('Veuillez sélectionner une classe', 'w');
    if (!matiereId) return toast('Veuillez sélectionner une matière', 'w');

    const btn = document.getElementById('btn-ajouter-aff') as HTMLButtonElement | null;
    if (btn) { btn.disabled = true; btn.textContent = 'Ajout…'; }

    try {
      await Api.post('/affectations', {
        enseignant_id: this.enseignantId,
        classe_id:     classeId,
        matiere_id:    matiereId,
        est_titulaire: !!titulaire,
      });
      toast('Affectation ajoutée ✓', 's');
      const selC = document.getElementById('m-aff-classe')  as HTMLSelectElement | null;
      const selM = document.getElementById('m-aff-matiere') as HTMLSelectElement | null;
      if (selC) selC.value = '';
      if (selM) selM.value = '';
      const cb = document.getElementById('m-aff-titulaire') as HTMLInputElement | null;
      if (cb) cb.checked = true;
      await this.chargerAffectations();
    } catch (e: any) {
      toast('Erreur : ' + (e.message || 'Ajout échoué'), 'd');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = "+ Ajouter l'affectation"; }
    }
  },

  async supprimer(affectationId: string) {
    if (!confirm('Supprimer cette affectation ?')) return;
    try {
      await Api.del('/affectations/' + affectationId);
      toast('Affectation supprimée', 's');
      await this.chargerAffectations();
    } catch (e: any) {
      toast('Erreur : ' + (e.message || 'Suppression échouée'), 'd');
    }
  },
};

(window as any).PageEnseignants = PageEnseignants;
(window as any).PageAffectations = PageAffectations;
PAGE_HOOKS['enseignants'] = () => PageEnseignants.init();
PAGE_HOOKS['affectations'] = () => PageAffectations.init();
