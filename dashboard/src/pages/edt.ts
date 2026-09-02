// @ts-nocheck
import { Api } from '../api';
import { Auth } from '../auth';
import { escapeHtml, toast, openModal, closeModal } from '../ui';
import { PAGE_HOOKS } from '../router';

export const PageEDT: any = {
  data: null,
  classeId: null,
  affectations: [],
  plages: null,       // cache global — rechargé une seule fois par session page
  listenerAttache: false,

  peutModifier: function() {
    var user = (typeof Auth !== 'undefined') ? Auth.getUser() : null;
    var role = (user && user.role) ? user.role.toLowerCase() : '';
    return role === 'directeur' || role === 'super_admin';
  },

  init: function() {
    var sel = document.getElementById('sel-classe-edt');
    var btnAjouter = document.getElementById('btn-edt-ajouter');

    if (btnAjouter) btnAjouter.style.display = this.peutModifier() ? '' : 'none';

    if (sel && !this.listenerAttache) {
      sel.addEventListener('change', function(e) {
        var classeId = e.target.value;
        if (classeId) {
          PageEDT.classeId = classeId;
          PageEDT.chargerEDTClasse(classeId);
          PageEDT.chargerAffectations(classeId);
        } else {
          PageEDT.classeId = null;
          var inner = document.getElementById('edt-grid');
          if (inner) inner.innerHTML = '<div style="text-align:center;padding:40px;color:var(--g400);font-size:13px">Sélectionnez une classe pour afficher son emploi du temps</div>';
          var sous = document.getElementById('ph-sous-edt');
          if (sous) sous.textContent = 'Sélectionnez une classe';
        }
      });
      this.listenerAttache = true;
    }

    // Si une classe est déjà sélectionnée (retour sur la page), recharger
    if (sel && sel.value) {
      this.classeId = sel.value;
      this.chargerEDTClasse(sel.value);
      this.chargerAffectations(sel.value);
    } else {
      var inner = document.getElementById('edt-grid');
      if (inner && !inner.innerHTML) {
        inner.innerHTML = '<div style="text-align:center;padding:40px;color:var(--g400);font-size:13px">Sélectionnez une classe pour afficher son emploi du temps</div>';
      }
    }
  },

  chargerEDTClasse: async function(classeId) {
    var inner = document.getElementById('edt-grid');
    if (!inner) return;

    inner.innerHTML = '<div style="text-align:center;padding:24px;color:var(--g400);font-size:13px">Chargement…</div>';

    try {
      var res = await Api.get('/edt/classe/' + encodeURIComponent(classeId));
      this.data = res.data;
      this.renderGrid(res.data);
      var sous = document.getElementById('ph-sous-edt');
      if (sous) sous.textContent = (res.data.classe || '') + ' · ' + (res.data.nb_creneaux || 0) + ' créneau(x)';
    } catch (e) {
      console.warn('PageEDT: impossible de charger l\'EDT —', e.message);
      inner.innerHTML = '<div style="text-align:center;padding:40px;color:var(--g400);font-size:13px">Emploi du temps indisponible</div>';
    }
  },

  chargerAffectations: async function(classeId) {
    try {
      var res = await Api.get('/classes/' + encodeURIComponent(classeId) + '/affectations');
      this.affectations = res.data || [];
    } catch (e) {
      console.warn('PageEDT: impossible de charger les affectations —', e.message);
      this.affectations = [];
    }
  },

  chargerPlages: async function() {
    if (this.plages) return this.plages;
    try {
      var res = await Api.get('/plages-horaires');
      this.plages = res.data || [];
    } catch (e) {
      console.warn('PageEDT: impossible de charger les plages horaires —', e.message);
      this.plages = [];
    }
    return this.plages;
  },

  renderGrid: function(data) {
    var inner = document.getElementById('edt-grid');
    if (!inner) return;

    if (!data || !data.emploi_du_temps || !data.emploi_du_temps.length) {
      inner.className = '';
      inner.innerHTML = '<div style="text-align:center;padding:40px;color:var(--g400);font-size:13px">Aucun créneau — cliquez sur « + Ajouter un créneau » pour commencer.</div>';
      return;
    }

    inner.className = 'edt-grid';
    // La CSS par défaut fige 5 colonnes (lundi→vendredi) ; un créneau
    // ajouté un samedi (jour_semaine=6, désormais possible via le modal)
    // ferait déborder/chevaucher la grille sans cet override explicite,
    // calculé sur le nombre réel de jours présents dans l'EDT.
    var joursNoms = data.emploi_du_temps.map(function(j) { return j.nom; });
    inner.style.gridTemplateColumns = '56px repeat(' + joursNoms.length + ', 1fr)';

    var jours = [''].concat(joursNoms);
    var html = jours.map(function(j) {
      return '<div class="edt-h">' + escapeHtml(j) + '</div>';
    }).join('');

    // Collecter toutes les plages horaires uniques présentes dans l'EDT
    var plages = {};
    data.emploi_du_temps.forEach(function(jour) {
      (jour.creneaux || []).forEach(function(c) {
        var key = c.heure_debut + '-' + c.heure_fin;
        plages[key] = { debut: c.heure_debut, fin: c.heure_fin, numero: c.plage_numero };
      });
    });

    var plagesArr = Object.values(plages).sort(function(a, b) { return a.numero - b.numero; });
    var cmat = {
      'Mathématiques': '#1A5276', 'Physique': '#7D3C98', 'SVT': '#1E8449',
      'Français': '#B7950B', 'Anglais': '#1B4F72', 'Philo': '#6C3483',
      'Histoire-Géo': '#935116', 'EPS': '#1A6B3A'
    };

    var peutModifier = this.peutModifier();

    plagesArr.forEach(function(plage) {
      html += '<div class="edt-t">' + escapeHtml(plage.debut) + '</div>';
      data.emploi_du_temps.forEach(function(jour) {
        var creneau = (jour.creneaux || []).find(function(c) {
          return c.heure_debut === plage.debut;
        });
        if (creneau && !creneau.est_pause) {
          var mat = creneau.matiere || '';
          var col = cmat[mat] || '#1A4731';
          var clickable = peutModifier ? ' style="cursor:pointer" data-creneau-id="' + escapeHtml(creneau.creneau_id) + '"' : '';
          html += '<div class="edt-slot"' + clickable + ' style="background:' + col + '14;border-left:3px solid ' + col + (peutModifier ? ';cursor:pointer' : '') + '">' +
            '<div class="edt-sm" style="color:' + col + '">' + escapeHtml(mat) + '</div>' +
            '<div class="edt-si" style="color:' + col + '">' + escapeHtml(creneau.classe || creneau.enseignant || '') + (creneau.salle ? ' · ' + escapeHtml(creneau.salle) : '') + '</div>' +
          '</div>';
        } else {
          html += '<div class="edt-slot vide"></div>';
        }
      });
    });

    inner.innerHTML = html;

    if (peutModifier) {
      inner.querySelectorAll('.edt-slot[data-creneau-id]').forEach(function(el) {
        el.addEventListener('click', function() {
          PageEDT.ouvrirModalCreneau(el.dataset.creneauId);
        });
      });
    }
  },

  // ── Modal création / édition ─────────────────────────────────────

  ouvrirModalCreneau: async function(creneauId) {
    if (!this.classeId) return toast('Sélectionnez une classe d\'abord', 'w');

    var titre       = document.getElementById('m-creneau-titre');
    var idField      = document.getElementById('m-creneau-id');
    var jourSel      = document.getElementById('m-creneau-jour');
    var salleInput   = document.getElementById('m-creneau-salle');
    var btnSupprimer = document.getElementById('btn-supprimer-creneau');
    var btnSave      = document.getElementById('btn-creneau-save');

    var creneauExistant = null;
    if (creneauId && this.data) {
      this.data.emploi_du_temps.forEach(function(jour) {
        (jour.creneaux || []).forEach(function(c) {
          if (c.creneau_id === creneauId) creneauExistant = Object.assign({}, c, { jour_semaine: jour.jour });
        });
      });
    }

    idField.value = creneauId || '';
    if (creneauExistant) {
      titre.textContent = 'Modifier le créneau';
      jourSel.value = String(creneauExistant.jour_semaine);
      salleInput.value = creneauExistant.salle || '';
      btnSupprimer.style.display = '';
      btnSave.textContent = 'Enregistrer';
    } else {
      titre.textContent = 'Nouveau créneau';
      jourSel.value = '1';
      salleInput.value = '';
      btnSupprimer.style.display = 'none';
      btnSave.textContent = 'Créer';
    }

    // Peupler le select plage horaire
    var plageSel = document.getElementById('m-creneau-plage');
    plageSel.innerHTML = '<option value="">Chargement…</option>';
    var plages = await this.chargerPlages();
    plageSel.innerHTML = plages.length
      ? plages.filter(function(p) { return !p.est_pause; }).map(function(p) {
          return '<option value="' + escapeHtml(p.id) + '">' + escapeHtml(p.libelle || (p.heure_debut + '-' + p.heure_fin)) + '</option>';
        }).join('')
      : '<option value="">Aucune plage horaire configurée</option>';
    if (creneauExistant) {
      var plageMatch = plages.find(function(p) { return p.numero === creneauExistant.plage_numero; });
      if (plageMatch) plageSel.value = plageMatch.id;
    }

    // Peupler le select matière/enseignant (affectations de la classe)
    var affSel = document.getElementById('m-creneau-affectation');
    affSel.innerHTML = this.affectations.length
      ? this.affectations.map(function(a) {
          return '<option value="' + escapeHtml(a.affectation_id) + '">' + escapeHtml(a.matiere) + ' — ' + escapeHtml(a.enseignant_prenom || '') + ' ' + escapeHtml(a.enseignant_nom || '') + '</option>';
        }).join('')
      : '<option value="">Aucune affectation pour cette classe</option>';
    if (creneauExistant && creneauExistant.affectation_id) {
      affSel.value = creneauExistant.affectation_id;
    }

    openModal('m-creneau');
  },

  sauvegarderCreneau: async function() {
    var creneauId = document.getElementById('m-creneau-id').value;
    var jour       = parseInt(document.getElementById('m-creneau-jour').value, 10);
    var plageId    = document.getElementById('m-creneau-plage').value;
    var affectationId = document.getElementById('m-creneau-affectation').value;
    var salle      = document.getElementById('m-creneau-salle').value.trim();

    if (!plageId)       return toast('La plage horaire est obligatoire', 'w');
    if (!affectationId) return toast('La matière / enseignant est obligatoire', 'w');

    var btn = document.getElementById('btn-creneau-save');
    if (btn) { btn.disabled = true; btn.textContent = creneauId ? 'Enregistrement…' : 'Création…'; }

    try {
      if (creneauId) {
        await Api.put('/edt/creneaux/' + encodeURIComponent(creneauId), {
          plage_id: plageId, jour_semaine: jour, affectation_id: affectationId,
          salle: salle || undefined,
        });
        toast('Créneau modifié ✓', 's');
      } else {
        await Api.post('/edt/creneaux', {
          classe_id: this.classeId, affectation_id: affectationId,
          plage_id: plageId, jour_semaine: jour, salle: salle || undefined,
        });
        toast('Créneau créé ✓', 's');
      }
      closeModal('m-creneau');
      await this.chargerEDTClasse(this.classeId);
    } catch (e) {
      // Le backend renvoie un message précis pour le conflit horaire
      // ("Un créneau existe déjà pour cette classe à cette plage horaire")
      toast('Erreur : ' + (e.message || 'Sauvegarde échouée'), 'd');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = creneauId ? 'Enregistrer' : 'Créer'; }
    }
  },

  supprimerCreneau: async function() {
    var creneauId = document.getElementById('m-creneau-id').value;
    if (!creneauId) return;
    if (!window.confirm('Supprimer ce créneau ?')) return;

    var btn = document.getElementById('btn-supprimer-creneau');
    if (btn) { btn.disabled = true; btn.textContent = 'Suppression…'; }

    try {
      await Api.del('/edt/creneaux/' + encodeURIComponent(creneauId));
      toast('Créneau supprimé ✓', 's');
      closeModal('m-creneau');
      await this.chargerEDTClasse(this.classeId);
    } catch (e) {
      toast('Erreur : ' + (e.message || 'Suppression échouée'), 'd');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '🗑 Supprimer'; }
    }
  }
};

(window as any).PageEDT = PageEDT;
PAGE_HOOKS['edt'] = () => PageEDT.init();
