'use strict';

/**
 * Page Paramètres — infos établissement + gestion des matières.
 */
var PageParametres = {
  async charger() {
    try {
      var res = await Api.get('/etablissement');
      this.remplirFormulaire(res.data);
    } catch (e) {
      console.warn('PageParametres: fallback statique —', e.message);
    }
    await this.chargerMatieres();
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
          return '<option value="' + id + '">' + disciplinesVues[id] + '</option>';
        });
        discSel.innerHTML = '<option value="">— Aucune discipline —</option>' + discOptions.join('');
      }

      if (!matieres.length) {
        liste.innerHTML = '<div style="color:var(--g400);font-size:13px;padding:10px">Aucune matière — cliquez sur « + Nouvelle matière » pour commencer.</div>';
        return;
      }
      liste.innerHTML = matieres.map(function(m) {
        return '<div style="display:flex;align-items:center;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--g100)">' +
          '<span style="font-size:13px"><strong>' + m.nom + '</strong>' +
          (m.nom_court ? ' <span style="color:var(--g400);font-size:11px">(' + m.nom_court + ')</span>' : '') +
          ' <span class="badge bo" style="font-size:10px">' + m.code + '</span>' +
          (m.discipline ? ' · ' + m.discipline : '') +
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

  init: function() { this.charger(); }
};

PAGE_HOOKS.parametres = function() { PageParametres.init(); };
