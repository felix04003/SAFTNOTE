import { Api } from '../api';
import { escapeHtml, toast } from '../ui';
import { PAGE_HOOKS, goto } from '../ens-router';

export const PageEnsAppel: any = {
  _appelId: null,
  _classeId: null,
  _eleves: [],
  _filtreClasseId: null,  // filtre pré-sélectionné depuis ens-classes

  async init() {
    const dateEl = document.getElementById('appel-date-aujourd-hui') as HTMLElement | null;
    if (dateEl) {
      const now = new Date();
      const opts: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
      dateEl.textContent = now.toLocaleDateString('fr-FR', opts);
    }

    this._appelId = null;
    this._classeId = null;
    this._eleves = [];

    this.retourCreneaux();
    await this._chargerCreneaux();
  },

  retourCreneaux() {
    this._appelId = null;
    const etapeCreneaux = document.getElementById('appel-etape-creneaux') as HTMLElement | null;
    const etapeGrille   = document.getElementById('appel-etape-grille')   as HTMLElement | null;
    if (etapeCreneaux) etapeCreneaux.style.display = '';
    if (etapeGrille)   etapeGrille.style.display   = 'none';
  },

  async _chargerCreneaux() {
    const liste = document.getElementById('appel-creneaux-liste') as HTMLElement | null;
    if (!liste) return;
    liste.innerHTML = '<div style="padding:20px;text-align:center;color:var(--g400)">Chargement…</div>';

    try {
      const res = await Api.get('/enseignants/moi/edt');
      const edt = (res.data && res.data.emploi_du_temps) || [];

      const jourJS  = new Date().getDay();
      const jourEDT = jourJS;

      const jourAuj = edt.find(function(j: any) { return j.jour === jourEDT; });
      let creneaux = (jourAuj && jourAuj.creneaux) || [];
      creneaux = creneaux.filter(function(c: any) { return !c.est_pause; });
      this._creneauxData = creneaux;

      if (this._filtreClasseId) {
        const filtreId = this._filtreClasseId;
        creneaux = creneaux.filter(function(c: any) { return c.classe_id === filtreId; });
        this._filtreClasseId = null;
      }

      if (!creneaux.length) {
        liste.innerHTML = '<div style="text-align:center;padding:32px;color:var(--g400)">' +
          '<div style="font-weight:600;font-size:14px;color:var(--g500)">Pas de cours aujourd\'hui</div>' +
          '<div style="font-size:12px;margin-top:6px">Consultez votre <a onclick="goto(\'ens-edt\')" style="color:var(--vert-lt);cursor:pointer">emploi du temps</a> pour la semaine.</div>' +
        '</div>';
        return;
      }

      liste.innerHTML = creneaux.map(function(c: any) {
        const matiere   = escapeHtml(c.matiere || '—');
        const classe    = escapeHtml(c.classe  || '');
        const heures    = escapeHtml((c.heure_debut || '') + ' – ' + (c.heure_fin || ''));
        const salle     = c.salle ? ' · <span style="color:var(--g400)">' + escapeHtml(c.salle) + '</span>' : '';
        const creneauId = escapeHtml(String(c.creneau_id || ''));

        return '<div style="display:flex;align-items:center;justify-content:space-between;padding:14px 0;border-bottom:1px solid var(--g100)">' +
          '<div>' +
            '<div style="font-weight:700;font-size:14px;color:var(--g900)">' + matiere + '</div>' +
            '<div style="font-size:12.5px;color:var(--g500);margin-top:3px">' +
              classe + ' · ' + heures + salle +
            '</div>' +
          '</div>' +
          '<button class="btn btn-p" onclick="PageEnsAppel.selectionnerCreneau(\'' + creneauId + '\')">' +
            'Faire l\'appel →' +
          '</button>' +
        '</div>';
      }).join('');

    } catch (e: any) {
      liste.innerHTML = '<div style="text-align:center;padding:28px;color:var(--rouge);font-size:13px">Impossible de charger les créneaux : ' + escapeHtml(e.message || '') + '</div>';
    }
  },

  // Appelé depuis le dashboard (bouton rapide)
  lancerDepuisCreneau(creneauId: string, matiere: string, classe: string, classeId: string) {
    goto('ens-appel');
    // Petit délai pour laisser la page s'afficher
    setTimeout(function() {
      PageEnsAppel.selectionnerCreneau(creneauId, matiere, classe, classeId);
    }, 200);
  },

  // Filtre pré-sélectionné depuis ens-classes
  filtrerParClasse(classeId: string) {
    this._filtreClasseId = classeId;
  },

  async selectionnerCreneau(creneauId: string, matiere?: string, classe?: string, classeId?: string) {
    if (!matiere && !classeId) {
      const cData = (this._creneauxData || []).find(function(c: any) { return String(c.creneau_id) === String(creneauId); });
      if (cData) { matiere = cData.matiere; classe = cData.classe; classeId = cData.classe_id; }
    }
    this._classeId = classeId;

    const etapeCreneaux = document.getElementById('appel-etape-creneaux') as HTMLElement | null;
    const etapeGrille   = document.getElementById('appel-etape-grille')   as HTMLElement | null;
    if (etapeCreneaux) etapeCreneaux.style.display = 'none';
    if (etapeGrille)   etapeGrille.style.display   = '';

    const titre = document.getElementById('appel-grille-titre') as HTMLElement | null;
    const sous  = document.getElementById('appel-grille-sous')  as HTMLElement | null;
    if (titre) titre.textContent = (matiere || '') + ' — ' + (classe || '');
    if (sous) {
      const now = new Date();
      sous.textContent = now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    }

    const tbody = document.getElementById('tb-appel-grille') as HTMLElement | null;
    if (tbody) tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:30px;color:var(--g400)">Ouverture de l\'appel…</td></tr>';

    try {
      const today = new Date().toISOString().split('T')[0];
      const res = await Api.post('/appels', {
        emploi_du_temps_id: creneauId,
        date_cours: today,
      });
      this._appelId = res.data && res.data.appel_id;

      const elevesRes = await Api.get('/classes/' + classeId + '/eleves');
      this._eleves = elevesRes.data || [];

      const nbEl = document.getElementById('appel-grille-nb') as HTMLElement | null;
      if (nbEl) nbEl.textContent = this._eleves.length + ' élève(s)';

      this._renderGrille(this._eleves);

    } catch (e: any) {
      if (tbody) tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:30px;color:var(--rouge)">Erreur : ' + escapeHtml(e.message || 'impossible d\'ouvrir l\'appel') + '</td></tr>';
    }
  },

  _renderGrille(eleves: any[]) {
    const tbody = document.getElementById('tb-appel-grille') as HTMLElement | null;
    if (!tbody) return;

    if (!eleves.length) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:30px;color:var(--g400)">Aucun élève dans cette classe</td></tr>';
      return;
    }

    tbody.innerHTML = eleves.map(function(el: any, i: number) {
      const nom = escapeHtml((el.nom || '') + ' ' + (el.prenom || ''));
      return '<tr id="ar-' + i + '">' +
        '<td style="font-weight:600">' + nom + '<input type="hidden" class="ar-inscr" value="' + escapeHtml(String(el.inscription_id || '')) + '"></td>' +
        '<td style="text-align:center"><input type="radio" name="stat-' + i + '" class="ar-stat" value="present" checked onchange="PageEnsAppel._onStatChange(' + i + ')"></td>' +
        '<td style="text-align:center"><input type="radio" name="stat-' + i + '" class="ar-stat" value="absent" onchange="PageEnsAppel._onStatChange(' + i + ')"></td>' +
        '<td style="text-align:center"><input type="radio" name="stat-' + i + '" class="ar-stat" value="retard" onchange="PageEnsAppel._onStatChange(' + i + ')"></td>' +
        '<td><input type="number" class="fi ar-retard" min="1" max="120" placeholder="min" disabled style="width:72px;padding:3px 7px;font-size:12px"></td>' +
      '</tr>';
    }).join('');
  },

  _onStatChange(i: number) {
    const row = document.getElementById('ar-' + i);
    if (!row) return;
    const checkedRadio = row.querySelector('input[name="stat-' + i + '"]:checked') as HTMLInputElement | null;
    const stat = checkedRadio ? checkedRadio.value : null;
    const retardInput = row.querySelector('.ar-retard') as HTMLInputElement | null;
    if (retardInput) retardInput.disabled = (stat !== 'retard');
  },

  marquerTousPresents() {
    document.querySelectorAll('#tb-appel-grille tr[id^="ar-"]').forEach(function(row: Element) {
      const i = parseInt((row as HTMLElement).id.replace('ar-', ''), 10);
      const radio = row.querySelector('input[value="present"]') as HTMLInputElement | null;
      if (radio) { radio.checked = true; PageEnsAppel._onStatChange(i); }
    });
  },

  async soumettre() {
    if (!this._appelId) return toast('Appel non initialisé', 'w');

    const rows = document.querySelectorAll('#tb-appel-grille tr[id^="ar-"]');
    const presences: Record<string, any>[] = [];

    rows.forEach(function(row: Element, i: number) {
      const inscriptionIdEl = row.querySelector('.ar-inscr') as HTMLInputElement | null;
      const inscriptionId   = inscriptionIdEl ? inscriptionIdEl.value : null;
      const checkedRadio    = row.querySelector('input[name="stat-' + i + '"]:checked') as HTMLInputElement | null;
      const stat            = checkedRadio ? checkedRadio.value : 'present';
      const retardEl        = row.querySelector('.ar-retard') as HTMLInputElement | null;
      const minutesRetard   = retardEl ? parseInt(retardEl.value) : NaN;

      if (inscriptionId) {
        const p: Record<string, any> = { inscription_id: inscriptionId, statut: stat };
        if (stat === 'retard' && !isNaN(minutesRetard) && minutesRetard > 0) p['minutes_retard'] = minutesRetard;
        presences.push(p);
      }
    });

    const nbIgnores = rows.length - presences.length;
    if (nbIgnores > 0) toast(nbIgnores + ' élève(s) sans identifiant ignoré(s)', 'w');
    if (!presences.length) return toast('Aucune présence à enregistrer', 'w');

    const btn = document.getElementById('btn-appel-soumettre') as HTMLButtonElement | null;
    if (btn) { btn.disabled = true; btn.textContent = 'Enregistrement…'; }

    try {
      await Api.put('/appels/' + this._appelId + '/presences', {
        presences,
        cloturer: true,
      });

      const nbAbsents = presences.filter(function(p) { return p['statut'] === 'absent' || p['statut'] === 'retard'; }).length;
      toast('Appel enregistré ✓' + (nbAbsents ? ' — ' + nbAbsents + ' absence(s) signalée(s), parents notifiés' : ''), 's');
      this.retourCreneaux();
      await this._chargerCreneaux();

    } catch (e: any) {
      toast(e.message || 'Erreur lors de la soumission', 'e');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Soumettre l\'appel'; }
    }
  },
};

(window as any).PageEnsAppel = PageEnsAppel;
PAGE_HOOKS['ens-appel'] = () => PageEnsAppel.init();
