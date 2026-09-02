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
    const user = (typeof Auth !== 'undefined') ? Auth.getUser() : null;
    const role = (user && user.role) ? user.role.toLowerCase() : '';
    return role === 'directeur' || role === 'super_admin';
  },

  init: function() {
    const sel       = document.getElementById('sel-classe-edt') as HTMLSelectElement | null;
    const btnAjouter = document.getElementById('btn-edt-ajouter') as HTMLElement | null;

    if (btnAjouter) btnAjouter.style.display = this.peutModifier() ? '' : 'none';

    if (sel && !this.listenerAttache) {
      sel.addEventListener('change', function(e: Event) {
        const classeId = (e.target as HTMLSelectElement).value;
        if (classeId) {
          PageEDT.classeId = classeId;
          PageEDT.chargerEDTClasse(classeId);
          PageEDT.chargerAffectations(classeId);
        } else {
          PageEDT.classeId = null;
          const inner = document.getElementById('edt-grid') as HTMLElement | null;
          if (inner) inner.innerHTML = '<div style="text-align:center;padding:40px;color:var(--g400);font-size:13px">Sélectionnez une classe pour afficher son emploi du temps</div>';
          const sous = document.getElementById('ph-sous-edt') as HTMLElement | null;
          if (sous) sous.textContent = 'Sélectionnez une classe';
        }
      });
      this.listenerAttache = true;
    }

    if (sel && sel.value) {
      this.classeId = sel.value;
      this.chargerEDTClasse(sel.value);
      this.chargerAffectations(sel.value);
    } else {
      const inner = document.getElementById('edt-grid') as HTMLElement | null;
      if (inner && !inner.innerHTML) {
        inner.innerHTML = '<div style="text-align:center;padding:40px;color:var(--g400);font-size:13px">Sélectionnez une classe pour afficher son emploi du temps</div>';
      }
    }
  },

  chargerEDTClasse: async function(classeId: string) {
    const inner = document.getElementById('edt-grid') as HTMLElement | null;
    if (!inner) return;

    inner.innerHTML = '<div style="text-align:center;padding:24px;color:var(--g400);font-size:13px">Chargement…</div>';

    try {
      const res = await Api.get('/edt/classe/' + encodeURIComponent(classeId));
      this.data = res.data;
      this.renderGrid(res.data);
      const sous = document.getElementById('ph-sous-edt') as HTMLElement | null;
      if (sous) sous.textContent = (res.data.classe || '') + ' · ' + (res.data.nb_creneaux || 0) + ' créneau(x)';
    } catch (e: any) {
      console.warn('PageEDT: impossible de charger l\'EDT —', e.message);
      inner.innerHTML = '<div style="text-align:center;padding:40px;color:var(--g400);font-size:13px">Emploi du temps indisponible</div>';
    }
  },

  chargerAffectations: async function(classeId: string) {
    try {
      const res = await Api.get('/classes/' + encodeURIComponent(classeId) + '/affectations');
      this.affectations = res.data || [];
    } catch (e: any) {
      console.warn('PageEDT: impossible de charger les affectations —', e.message);
      this.affectations = [];
    }
  },

  chargerPlages: async function() {
    if (this.plages) return this.plages;
    try {
      const res = await Api.get('/plages-horaires');
      this.plages = res.data || [];
    } catch (e: any) {
      console.warn('PageEDT: impossible de charger les plages horaires —', e.message);
      this.plages = [];
    }
    return this.plages;
  },

  renderGrid: function(data: any) {
    const inner = document.getElementById('edt-grid') as HTMLElement | null;
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
    const joursNoms = data.emploi_du_temps.map(function(j: any) { return j.nom; });
    inner.style.gridTemplateColumns = '56px repeat(' + joursNoms.length + ', 1fr)';

    const jours: string[] = [''].concat(joursNoms);
    let html = jours.map(function(j: string) {
      return '<div class="edt-h">' + escapeHtml(j) + '</div>';
    }).join('');

    // Collecter toutes les plages horaires uniques présentes dans l'EDT
    const plages: Record<string, any> = {};
    data.emploi_du_temps.forEach(function(jour: any) {
      (jour.creneaux || []).forEach(function(c: any) {
        const key = c.heure_debut + '-' + c.heure_fin;
        plages[key] = { debut: c.heure_debut, fin: c.heure_fin, numero: c.plage_numero };
      });
    });

    const plagesArr: any[] = Object.values(plages).sort(function(a: any, b: any) { return a.numero - b.numero; });
    const cmat: Record<string, string> = {
      'Mathématiques': '#1A5276', 'Physique': '#7D3C98', 'SVT': '#1E8449',
      'Français': '#B7950B', 'Anglais': '#1B4F72', 'Philo': '#6C3483',
      'Histoire-Géo': '#935116', 'EPS': '#1A6B3A'
    };

    const peutModifier = this.peutModifier();

    plagesArr.forEach(function(plage: any) {
      html += '<div class="edt-t">' + escapeHtml(plage.debut) + '</div>';
      data.emploi_du_temps.forEach(function(jour: any) {
        const creneau = (jour.creneaux || []).find(function(c: any) {
          return c.heure_debut === plage.debut;
        });
        if (creneau && !creneau.est_pause) {
          const mat = creneau.matiere || '';
          const col = cmat[mat] || '#1A4731';
          const clickable = peutModifier ? ' style="cursor:pointer" data-creneau-id="' + escapeHtml(creneau.creneau_id) + '"' : '';
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
      inner.querySelectorAll('.edt-slot[data-creneau-id]').forEach(function(el: Element) {
        el.addEventListener('click', function() {
          PageEDT.ouvrirModalCreneau((el as HTMLElement).dataset.creneauId);
        });
      });
    }
  },

  // ── Modal création / édition ─────────────────────────────────────

  ouvrirModalCreneau: async function(creneauId?: string) {
    if (!this.classeId) return toast('Sélectionnez une classe d\'abord', 'w');

    const titre       = document.getElementById('m-creneau-titre') as HTMLElement | null;
    const idField     = document.getElementById('m-creneau-id') as HTMLInputElement | null;
    const jourSel     = document.getElementById('m-creneau-jour') as HTMLSelectElement | null;
    const salleInput  = document.getElementById('m-creneau-salle') as HTMLInputElement | null;
    const btnSupprimer = document.getElementById('btn-supprimer-creneau') as HTMLElement | null;
    const btnSave     = document.getElementById('btn-creneau-save') as HTMLElement | null;

    let creneauExistant: any = null;
    if (creneauId && this.data) {
      this.data.emploi_du_temps.forEach(function(jour: any) {
        (jour.creneaux || []).forEach(function(c: any) {
          if (c.creneau_id === creneauId) creneauExistant = Object.assign({}, c, { jour_semaine: jour.jour });
        });
      });
    }

    if (idField) idField.value = creneauId || '';
    if (creneauExistant) {
      if (titre) titre.textContent = 'Modifier le créneau';
      if (jourSel) jourSel.value = String(creneauExistant.jour_semaine);
      if (salleInput) salleInput.value = creneauExistant.salle || '';
      if (btnSupprimer) btnSupprimer.style.display = '';
      if (btnSave) btnSave.textContent = 'Enregistrer';
    } else {
      if (titre) titre.textContent = 'Nouveau créneau';
      if (jourSel) jourSel.value = '1';
      if (salleInput) salleInput.value = '';
      if (btnSupprimer) btnSupprimer.style.display = 'none';
      if (btnSave) btnSave.textContent = 'Créer';
    }

    // Peupler le select plage horaire
    const plageSel = document.getElementById('m-creneau-plage') as HTMLSelectElement | null;
    if (plageSel) plageSel.innerHTML = '<option value="">Chargement…</option>';
    const plages = await this.chargerPlages();
    if (plageSel) {
      plageSel.innerHTML = plages.length
        ? plages.filter(function(p: any) { return !p.est_pause; }).map(function(p: any) {
            return '<option value="' + escapeHtml(p.id) + '">' + escapeHtml(p.libelle || (p.heure_debut + '-' + p.heure_fin)) + '</option>';
          }).join('')
        : '<option value="">Aucune plage horaire configurée</option>';
      if (creneauExistant) {
        const plageMatch = plages.find(function(p: any) { return p.numero === creneauExistant.plage_numero; });
        if (plageMatch) plageSel.value = plageMatch.id;
      }
    }

    // Peupler le select matière/enseignant (affectations de la classe)
    const affSel = document.getElementById('m-creneau-affectation') as HTMLSelectElement | null;
    if (affSel) {
      affSel.innerHTML = this.affectations.length
        ? this.affectations.map(function(a: any) {
            return '<option value="' + escapeHtml(a.affectation_id) + '">' + escapeHtml(a.matiere) + ' — ' + escapeHtml(a.enseignant_prenom || '') + ' ' + escapeHtml(a.enseignant_nom || '') + '</option>';
          }).join('')
        : '<option value="">Aucune affectation pour cette classe</option>';
      if (creneauExistant && creneauExistant.affectation_id) {
        affSel.value = creneauExistant.affectation_id;
      }
    }

    openModal('m-creneau');
  },

  sauvegarderCreneau: async function() {
    const creneauId    = (document.getElementById('m-creneau-id')          as HTMLInputElement | null)?.value || '';
    const jour         = parseInt((document.getElementById('m-creneau-jour') as HTMLSelectElement | null)?.value || '1', 10);
    const plageId      = (document.getElementById('m-creneau-plage')        as HTMLSelectElement | null)?.value || '';
    const affectationId = (document.getElementById('m-creneau-affectation') as HTMLSelectElement | null)?.value || '';
    const salle        = ((document.getElementById('m-creneau-salle')       as HTMLInputElement | null)?.value || '').trim();

    if (!plageId)       return toast('La plage horaire est obligatoire', 'w');
    if (!affectationId) return toast('La matière / enseignant est obligatoire', 'w');

    const btn = document.getElementById('btn-creneau-save') as HTMLButtonElement | null;
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
    } catch (e: any) {
      // Le backend renvoie un message précis pour le conflit horaire
      // ("Un créneau existe déjà pour cette classe à cette plage horaire")
      toast('Erreur : ' + (e.message || 'Sauvegarde échouée'), 'd');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = creneauId ? 'Enregistrer' : 'Créer'; }
    }
  },

  supprimerCreneau: async function() {
    const creneauId = (document.getElementById('m-creneau-id') as HTMLInputElement | null)?.value || '';
    if (!creneauId) return;
    if (!window.confirm('Supprimer ce créneau ?')) return;

    const btn = document.getElementById('btn-supprimer-creneau') as HTMLButtonElement | null;
    if (btn) { btn.disabled = true; btn.textContent = 'Suppression…'; }

    try {
      await Api.del('/edt/creneaux/' + encodeURIComponent(creneauId));
      toast('Créneau supprimé ✓', 's');
      closeModal('m-creneau');
      await this.chargerEDTClasse(this.classeId);
    } catch (e: any) {
      toast('Erreur : ' + (e.message || 'Suppression échouée'), 'd');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '🗑 Supprimer'; }
    }
  }
};

(window as any).PageEDT = PageEDT;
PAGE_HOOKS['edt'] = () => PageEDT.init();
