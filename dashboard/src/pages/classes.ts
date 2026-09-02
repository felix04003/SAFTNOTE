import { Api } from '../api';
import { escapeHtml, cn, toast, openModal, closeModal } from '../ui';
import { PAGE_HOOKS } from '../router';

export const PageClasses: any = {
  data: [],
  _niveaux: [],   // cache des niveaux pour le modal

  async charger() {
    try {
      const res = await Api.get('/classes');
      const classes = res.data || [];
      this.data = classes;
      this.renderGrid(classes);
      this.peuplerDropdowns(classes);
      const sous = document.getElementById('ph-sous-classes') as HTMLElement | null;
      if (sous) sous.textContent = classes.length + ' classe' + (classes.length > 1 ? 's' : '') + ' · Année en cours';
      return true;
    } catch (e: any) {
      console.error('PageClasses.charger —', e.message);
      return false;
    }
  },

  peuplerDropdowns: function(classes: any[]) {
    const selects = [
      document.getElementById('sel-classe-eleves'),
      document.getElementById('sel-classe-edt'),
      document.getElementById('m-eleve-classe'),
    ] as (HTMLSelectElement | null)[];
    selects.forEach(function(sel) {
      if (!sel) return;
      const valActuelle = sel.value;
      while (sel.options.length > 1) sel.remove(1);
      classes.forEach(function(c: any) {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = c.nom_classe || c.nom || c.id;
        sel.appendChild(opt);
      });
      if (valActuelle) sel.value = valActuelle;
    });
  },

  async chargerNiveaux() {
    if (this._niveaux.length) return;
    try {
      const res = await Api.get('/niveaux');
      this._niveaux = res.data || [];
      const sel = document.getElementById('m-classe-niveau') as HTMLSelectElement | null;
      if (!sel) return;
      sel.innerHTML = '<option value="">— Choisir un niveau —</option>' +
        this._niveaux.map(function(n: any) {
          return '<option value="' + escapeHtml(String(n.id || '')) + '">' + escapeHtml(n.nom || '') + '</option>';
        }).join('');
    } catch (e: any) {
      console.warn('PageClasses.chargerNiveaux —', e.message);
    }
  },

  ouvrirModal: function() {
    this.chargerNiveaux();
    openModal('m-classe');
  },

  async creer() {
    const niveauId  = (document.getElementById('m-classe-niveau')  as HTMLSelectElement | null)?.value;
    const nom       = (document.getElementById('m-classe-nom')     as HTMLInputElement  | null)?.value?.trim().toUpperCase();
    const salle     = (document.getElementById('m-classe-salle')   as HTMLInputElement  | null)?.value?.trim();
    const effectif  = parseInt((document.getElementById('m-classe-effectif') as HTMLInputElement | null)?.value || '') || undefined;

    if (!niveauId) return toast('Choisissez un niveau', 'w');
    if (!nom)      return toast('La lettre de classe est obligatoire', 'w');

    const payload: Record<string, any> = {
      niveau_id:        niveauId,
      nom,
      salle_principale: salle || undefined,
      effectif_max:     effectif,
    };

    const btn = document.getElementById('btn-creer-classe') as HTMLButtonElement | null;
    if (btn) { btn.disabled = true; btn.textContent = 'Création…'; }

    try {
      const res = await Api.post('/classes', payload);
      closeModal('m-classe');
      const label = (res.data && (res.data.niveau + ' ' + res.data.nom)) || nom;
      toast('Classe ' + label + ' créée ✓', 's');
      this._niveaux = [];
      await this.charger();
    } catch (e: any) {
      toast('Erreur : ' + (e.message || 'Création échouée'), 'd');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Créer la classe'; }
    }
  },

  renderGrid: function(classes: any[]) {
    const grid = document.getElementById('cls-grid') as HTMLElement | null;
    if (!grid) return;

    if (!classes.length) {
      grid.innerHTML = '<div style="text-align:center;color:var(--g400);padding:40px;grid-column:1/-1">Aucune classe — cliquez sur "+ Nouvelle classe" pour en créer une</div>';
      return;
    }

    grid.innerHTML = classes.map(function(c: any) {
      const nom      = escapeHtml(c.nom_classe || c.nom || '—');
      const effectif = c.effectif || c.effectif_max || 0;
      const moy      = c.moyenne != null ? c.moyenne : null;
      const pres     = c.taux_presence != null ? c.taux_presence : null;
      const salle    = escapeHtml(c.salle_principale || '');

      return '<div class="carte" style="cursor:pointer;transition:transform .15s" onmouseenter="this.style.transform=\'translateY(-3px)\'" onmouseleave="this.style.transform=\'\'">' +
        '<div style="padding:16px 18px">' +
          '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:11px">' +
            '<div><div style="font-size:17px;font-weight:800">' + nom + '</div>' +
            '<div style="font-size:11.5px;color:var(--g400);margin-top:2px">' + salle + (effectif ? ' · ' + effectif + ' élèves' : '') + '</div></div>' +
            (moy != null ? '<div class="nb" style="color:' + cn(moy) + ';font-size:12px;width:38px;height:38px">' + moy + '</div>' : '') +
          '</div>' +
          (pres != null ?
            '<div style="display:flex;justify-content:space-between;font-size:11.5px;margin-bottom:3px">' +
              '<span style="color:var(--g500)">Présence</span>' +
              '<span style="font-weight:700;color:' + (pres >= 92 ? 'var(--success)' : pres >= 85 ? 'var(--warning)' : 'var(--rouge)') + '">' + pres + '%</span>' +
            '</div>' +
            '<div class="pb"><div class="pf" style="width:' + pres + '%;--c:' + (pres >= 92 ? 'var(--success)' : pres >= 85 ? 'var(--warning)' : 'var(--rouge)') + '"></div></div>' : '') +
          '<div style="display:flex;gap:6px;margin-top:12px">' +
            '<button class="btn btn-l btn-sm" style="flex:1" onclick="PageClasses.voirClasse(\'' + c.id + '\')">Voir</button>' +
            '<button class="btn btn-l btn-sm" onclick="goto(\'edt\')">📅</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    }).join('');
  },

  voirClasse: async function(id: string) {
    const classe = this.data.find(function(c: any) { return c.id === id; });
    const nom = classe ? (classe.nom_classe || classe.nom || 'Classe') : 'Classe';

    const _set = (elId: string, val: string) => {
      const el = document.getElementById(elId) as HTMLElement | null;
      if (el) el.textContent = val;
    };
    const _html = (elId: string, val: string) => {
      const el = document.getElementById(elId) as HTMLElement | null;
      if (el) el.innerHTML = val;
    };

    _set('m-detail-classe-titre', nom);
    _set('dc-salle', (classe && classe.salle_principale) || '—');
    _set('dc-nb-eleves', '…');
    _set('dc-nb-matieres', '…');
    _html('dc-affectations', '<span style="color:var(--g400);font-size:13px">Chargement…</span>');
    _html('dc-eleves', '<span style="color:var(--g400);font-size:13px">Chargement…</span>');

    openModal('m-detail-classe');

    try {
      const results = await Promise.all([
        Api.get('/classes/' + id + '/eleves'),
        Api.get('/classes/' + id + '/affectations'),
      ]);
      const eleves       = results[0].data || [];
      const affectations = results[1].data || [];

      _set('dc-nb-eleves', String(eleves.length));
      _set('dc-nb-matieres', String(affectations.length));

      if (!affectations.length) {
        _html('dc-affectations', '<span style="color:var(--g400);font-size:13px">Aucun enseignant affecté</span>');
      } else {
        _html('dc-affectations', affectations.map(function(a: any) {
          return '<span style="display:inline-flex;align-items:center;gap:5px;background:var(--g100);border-radius:20px;padding:4px 10px;font-size:12px">' +
            '<span style="width:8px;height:8px;border-radius:50%;background:' + escapeHtml(a.couleur_affichage || 'var(--vert)') + ';display:inline-block"></span>' +
            '<b>' + escapeHtml(a.matiere || '—') + '</b>' +
            '<span style="color:var(--g500)">— ' + escapeHtml((a.enseignant_prenom || '') + ' ' + (a.enseignant_nom || '')) + '</span>' +
          '</span>';
        }).join(''));
      }

      if (!eleves.length) {
        _html('dc-eleves', '<div style="text-align:center;color:var(--g400);padding:20px">Aucun élève inscrit dans cette classe</div>');
      } else {
        _html('dc-eleves', '<table style="width:100%;border-collapse:collapse;font-size:13px">' +
          '<thead><tr style="border-bottom:1px solid var(--g200)">' +
            '<th style="text-align:left;padding:6px 8px;font-weight:600;color:var(--g600)">#</th>' +
            '<th style="text-align:left;padding:6px 8px;font-weight:600;color:var(--g600)">Nom</th>' +
            '<th style="text-align:left;padding:6px 8px;font-weight:600;color:var(--g600)">Prénom</th>' +
            '<th style="text-align:left;padding:6px 8px;font-weight:600;color:var(--g600)">Matricule</th>' +
          '</tr></thead>' +
          '<tbody>' +
          eleves.map(function(e: any, i: number) {
            return '<tr style="border-bottom:1px solid var(--g100)">' +
              '<td style="padding:7px 8px;color:var(--g400)">' + (i + 1) + '</td>' +
              '<td style="padding:7px 8px;font-weight:600">' + escapeHtml(e.nom || '—') + '</td>' +
              '<td style="padding:7px 8px">' + escapeHtml(e.prenom || '—') + '</td>' +
              '<td style="padding:7px 8px;font-family:monospace;font-size:11px;color:var(--g500)">' + escapeHtml(e.matricule || '—') + '</td>' +
            '</tr>';
          }).join('') +
          '</tbody></table>');
      }
    } catch (err: any) {
      _html('dc-eleves', '<span style="color:var(--rouge);font-size:13px">Erreur : ' + escapeHtml(err.message || '') + '</span>');
    }
  },
  init: function() { this.charger(); }
};

(window as any).PageClasses = PageClasses;
PAGE_HOOKS['classes'] = () => PageClasses.init();
