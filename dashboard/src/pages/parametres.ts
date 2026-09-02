// @ts-nocheck
import { Api } from '../api';
import { escapeHtml, toast, openModal, closeModal } from '../ui';
import { PAGE_HOOKS } from '../router';

export const PageParametres: any = {
  async charger() {
    try {
      var res = await Api.get('/etablissement');
      this.remplirFormulaire(res.data);
    } catch (e) {
      console.warn('PageParametres: fallback statique —', e.message);
    }
    await this.chargerMatieres();
    await this.chargerCoefficients();
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

  // ── Matières ────────────────────────────────────────────────────

  async chargerMatieres() {
    var liste = document.getElementById('param-matieres-liste');
    if (!liste) return;
    liste.innerHTML = '<div style="color:var(--g400);font-size:13px;padding:10px">Chargement…</div>';
    try {
      var res = await Api.get('/configs/matieres');
      var matieres = res.data || [];
      this.matieresCache = matieres;

      // Extraire les disciplines uniques pour le select du modal m-matiere
      var discSel = document.getElementById('m-mat-discipline');
      if (discSel) {
        var disciplinesVues = {};
        matieres.forEach(function(m) {
          if (m.discipline_id && !disciplinesVues[m.discipline_id]) {
            disciplinesVues[m.discipline_id] = m.discipline;
          }
        });
        var discOptions = Object.keys(disciplinesVues).map(function(id) {
          return '<option value="' + escapeHtml(id) + '">' + escapeHtml(disciplinesVues[id]) + '</option>';
        });
        discSel.innerHTML = '<option value="">— Aucune discipline —</option>' + discOptions.join('');
      }

      if (!matieres.length) {
        liste.innerHTML = '<div style="color:var(--g400);font-size:13px;padding:10px">Aucune matière — cliquez sur « + Nouvelle matière » pour commencer.</div>';
        return;
      }
      liste.innerHTML = matieres.map(function(m) {
        return '<div style="display:flex;align-items:center;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--g100)">' +
          '<span style="font-size:13px"><strong>' + escapeHtml(m.nom) + '</strong>' +
          (m.nom_court ? ' <span style="color:var(--g400);font-size:11px">(' + escapeHtml(m.nom_court) + ')</span>' : '') +
          ' <span class="badge bo" style="font-size:10px">' + escapeHtml(m.code) + '</span>' +
          (m.discipline ? ' · ' + escapeHtml(m.discipline) : '') +
          (!m.actif ? ' <span class="badge bd" style="font-size:10px">Inactif</span>' : '') +
          '</span>' +
        '</div>';
      }).join('');
    } catch (e) {
      liste.innerHTML = '<div style="color:var(--rouge);font-size:13px;padding:10px">Impossible de charger les matières</div>';
    }
  },

  async creerMatiere() {
    var nom          = document.getElementById('m-mat-nom')?.value?.trim();
    var court        = document.getElementById('m-mat-court')?.value?.trim();
    var code         = document.getElementById('m-mat-code')?.value?.trim().toUpperCase();
    var moyenne      = document.getElementById('m-mat-moyenne')?.value === 'true';
    var disciplineId = document.getElementById('m-mat-discipline')?.value || undefined;

    if (!nom)  return toast('Le nom est obligatoire', 'w');
    if (!code) return toast('Le code est obligatoire', 'w');

    var btn = document.getElementById('btn-creer-matiere');
    if (btn) { btn.disabled = true; btn.textContent = 'Création…'; }

    try {
      await Api.post('/configs/matieres', {
        nom: nom,
        nom_court: court || undefined,
        code: code,
        compte_dans_moyenne: moyenne,
        discipline_id: disciplineId || undefined,
      });
      closeModal('m-matiere');
      toast('Matière « ' + nom + ' » créée ✓', 's');
      ['m-mat-nom', 'm-mat-court', 'm-mat-code'].forEach(function(id) {
        var el = document.getElementById(id); if (el) el.value = '';
      });
      await this.chargerMatieres();
    } catch (e) {
      toast('Erreur : ' + (e.message || 'Création échouée'), 'd');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Créer la matière'; }
    }
  },

  // ── Coefficients ────────────────────────────────────────────────

  async chargerCoefficients() {
    var liste = document.getElementById('param-coefficients-liste');
    if (!liste) return;
    liste.innerHTML = '<div style="color:var(--g400);font-size:13px;padding:10px">Chargement…</div>';
    try {
      var res = await Api.get('/configs/coefficients');
      var niveaux = (res.data && res.data.niveaux) || [];
      this.niveauxCoefCache = niveaux;

      if (!niveaux.length) {
        liste.innerHTML = '<div style="color:var(--g400);font-size:13px;padding:10px">Aucun coefficient configuré — cliquez sur « + Assigner un coefficient » pour commencer.</div>';
        return;
      }
      liste.innerHTML = niveaux.map(function(n) {
        var lignes = n.matieres.map(function(m) {
          return '<div style="display:flex;align-items:center;justify-content:space-between;padding:5px 0 5px 14px;font-size:12.5px">' +
            '<span>' + escapeHtml(m.matiere) + (m.serie ? ' <span style="color:var(--g400)">(' + escapeHtml(m.serie) + ')</span>' : '') + '</span>' +
            '<span class="badge bo" style="font-size:10px">coef. ' + escapeHtml(String(m.coefficient)) + '</span>' +
          '</div>';
        }).join('');
        return '<div style="padding:6px 0;border-bottom:1px solid var(--g100)">' +
          '<div style="font-size:12px;font-weight:700;color:var(--g500)">' + escapeHtml(n.niveau) + '</div>' +
          lignes +
        '</div>';
      }).join('');
    } catch (e) {
      liste.innerHTML = '<div style="color:var(--rouge);font-size:13px;padding:10px">Impossible de charger les coefficients</div>';
    }
  },

  async ouvrirModalCoefficient() {
    var niveauSel  = document.getElementById('m-coef-niveau');
    var matiereSel = document.getElementById('m-coef-matiere');

    if (matiereSel) {
      var matieres = this.matieresCache || [];
      matiereSel.innerHTML = matieres.length
        ? matieres.map(function(m) { return '<option value="' + escapeHtml(m.id) + '">' + escapeHtml(m.nom) + '</option>'; }).join('')
        : '<option value="">Aucune matière — créez-en une d\'abord</option>';
    }

    if (niveauSel) {
      niveauSel.innerHTML = '<option value="">Chargement des niveaux…</option>';
      try {
        var res = await Api.get('/niveaux');
        var niveaux = res.data || [];
        this.niveauxCache = niveaux;
        niveauSel.innerHTML = niveaux.length
          ? niveaux.map(function(n) { return '<option value="' + escapeHtml(n.id) + '">' + escapeHtml(n.nom) + '</option>'; }).join('')
          : '<option value="">Aucun niveau configuré</option>';
      } catch (e) {
        niveauSel.innerHTML = '<option value="">Erreur de chargement</option>';
      }
    }

    openModal('m-coefficient');
  },

  async assignerCoefficient() {
    var niveauId      = document.getElementById('m-coef-niveau')?.value;
    var matiereId     = document.getElementById('m-coef-matiere')?.value;
    var coefficient   = parseFloat(document.getElementById('m-coef-coefficient')?.value);
    var estObligatoire = document.getElementById('m-coef-obligatoire')?.value === 'true';

    if (!niveauId)  return toast('Le niveau est obligatoire', 'w');
    if (!matiereId) return toast('La matière est obligatoire', 'w');
    if (!coefficient || coefficient < 0.5 || coefficient > 10) return toast('Coefficient invalide (0.5 à 10)', 'w');

    var btn = document.getElementById('btn-assigner-coefficient');
    if (btn) { btn.disabled = true; btn.textContent = 'Assignation…'; }

    try {
      await Api.post('/configs/coefficients', {
        matiere_id: matiereId,
        niveau_id: niveauId,
        coefficient: coefficient,
        est_obligatoire: estObligatoire,
      });
      closeModal('m-coefficient');
      toast('Coefficient assigné ✓', 's');
      await this.chargerCoefficients();
    } catch (e) {
      toast('Erreur : ' + (e.message || 'Assignation échouée'), 'd');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Assigner'; }
    }
  },

  init: function() { this.charger(); }
};

(window as any).PageParametres = PageParametres;
PAGE_HOOKS['parametres'] = () => PageParametres.init();
