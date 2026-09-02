import { Api } from '../api';
import { escapeHtml, cn, toast, openModal, closeModal } from '../ui';
import { PAGE_HOOKS } from '../router';

export const PageNotes: any = {
  data:       [],
  _periodes:  [],
  _classes:   [],
  _evalCourant: null,  // { id, titre, classe_id, note_max }

  // ── Initialisation ───────────────────────────────────────────────
  async init() {
    await Promise.all([ this._chargerPeriodes(), this._chargerClasses() ]);
    this._peuplerFiltres();
    await this.charger();
  },

  async _chargerPeriodes() {
    try {
      const r = await Api.get('/annees-scolaires/courante');
      this._periodes = (r.data && r.data.periodes) || [];
    } catch (e: any) { this._periodes = []; }
  },

  async _chargerClasses() {
    try {
      const r = await Api.get('/classes');
      this._classes = r.data || [];
    } catch (e: any) { this._classes = []; }
  },

  _peuplerFiltres() {
    const selClasse  = document.getElementById('fil-notes-classe')   as HTMLSelectElement | null;
    const selPeriode = document.getElementById('fil-notes-periode')  as HTMLSelectElement | null;
    if (selClasse) {
      selClasse.innerHTML = '<option value="">Toutes les classes</option>' +
        this._classes.map(function(c: any) {
          return '<option value="' + c.id + '">' + c.nom_classe + '</option>';
        }).join('');
    }
    if (selPeriode) {
      selPeriode.innerHTML = '<option value="">Toutes les périodes</option>' +
        this._periodes.map(function(p: any) {
          return '<option value="' + p.id + '">' + p.libelle + '</option>';
        }).join('');
    }
  },

  // ── Chargement des évaluations ───────────────────────────────────
  async charger() {
    try {
      let params = '';
      const classeId  = (document.getElementById('fil-notes-classe')  as HTMLSelectElement | null)?.value;
      const periodeId = (document.getElementById('fil-notes-periode') as HTMLSelectElement | null)?.value;
      if (classeId)  params += (params ? '&' : '?') + 'classe_id='  + classeId;
      if (periodeId) params += (params ? '&' : '?') + 'periode_id=' + periodeId;

      const res = await Api.get('/evaluations' + params);
      this.data = res.data || [];
      this.renderTable(this.data);
    } catch (e: any) {
      console.warn('PageNotes: erreur chargement —', e.message);
      this.data = [];
      this.renderTable([]);
    }
  },

  // ── Affichage du tableau ─────────────────────────────────────────
  renderTable(evals: any[]) {
    const tbody = document.getElementById('tb-eval') as HTMLElement | null;
    if (!tbody) return;

    if (!evals.length) {
      tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;color:var(--g400);padding:30px">Aucune évaluation — créez-en une avec "+ Nouvelle évaluation"</td></tr>';
      return;
    }

    tbody.innerHTML = evals.map(function(ev: any) {
      const moy = ev.moyenne_classe != null ? ev.moyenne_classe : null;
      const st  = ev.statut || 'non_saisie';
      const stBadge = st === 'publiee'
        ? '<span class="badge bs">Publiée</span>'
        : st === 'brouillon'
          ? '<span class="badge bw">Brouillon</span>'
          : '<span class="badge bd">Non saisie</span>';

      const matiere    = escapeHtml(ev.matiere || '—');
      const classe     = escapeHtml(ev.classe  || '—');
      const typeLabel  = escapeHtml(ev.type    || '—');
      const date       = escapeHtml(ev.date_evaluation || '—');
      const enseignant = escapeHtml(ev.enseignant || '—');

      // Passer uniquement l'id (UUID safe) — le titre est calculé dans ouvrirSaisie()
      const actions = st !== 'publiee'
        ? '<button class="btn btn-l btn-sm" onclick="event.stopPropagation();PageNotes.ouvrirSaisie(\'' + ev.id + '\')" style="padding:4px 10px;font-size:11px">✏️ Saisir</button>'
        : '<button class="btn btn-sm" style="padding:4px 10px;font-size:11px;background:var(--g100);color:var(--g500);cursor:default">👁 Voir</button>';

      return '<tr style="cursor:pointer" onclick="PageNotes.ouvrirSaisie(\'' + ev.id + '\')">' +
        '<td class="nc">' + matiere + '</td>' +
        '<td><span class="badge bp">' + classe + '</span></td>' +
        '<td><span class="badge bo">' + typeLabel + '</span></td>' +
        '<td style="font-family:\'Space Mono\',monospace;font-size:11.5px">' + date + '</td>' +
        '<td>' + enseignant + '</td>' +
        '<td>' + (moy != null ? '<span style="font-weight:700;color:' + cn(moy) + '">' + moy + '/20</span>' : '<span class="badge bd">—</span>') + '</td>' +
        '<td style="color:var(--g400)">' + (ev.note_min != null ? ev.note_min : '—') + '</td>' +
        '<td style="color:var(--g400)">' + (ev.note_max != null ? ev.note_max : '—') + '</td>' +
        '<td>' + stBadge + '</td>' +
        '<td onclick="event.stopPropagation()">' + actions + '</td>' +
      '</tr>';
    }).join('');
  },

  // ── Créer une évaluation ─────────────────────────────────────────
  async ouvrirModalEval() {
    // Remplir le select classe
    const selClasse = document.getElementById('ev-classe') as HTMLSelectElement | null;
    if (selClasse) {
      selClasse.innerHTML = '<option value="">— Choisir une classe —</option>' +
        this._classes.map(function(c: any) {
          return '<option value="' + c.id + '">' + c.nom_classe + '</option>';
        }).join('');
      // reset affectations
      const selAff = document.getElementById('ev-affectation') as HTMLSelectElement | null;
      if (selAff) selAff.innerHTML = '<option value="">— Sélectionnez d\'abord une classe —</option>';
    }
    // Remplir le select période
    const selPer = document.getElementById('ev-periode') as HTMLSelectElement | null;
    if (selPer) {
      selPer.innerHTML = this._periodes.map(function(p: any) {
        return '<option value="' + p.id + '">' + p.libelle + '</option>';
      }).join('');
    }
    openModal('m-evaluation');
  },

  async onClasseChangeEval() {
    const classeId = (document.getElementById('ev-classe') as HTMLSelectElement | null)?.value;
    const selAff   = document.getElementById('ev-affectation') as HTMLSelectElement | null;
    if (!selAff) return;
    if (!classeId) {
      selAff.innerHTML = '<option value="">— Sélectionnez d\'abord une classe —</option>';
      return;
    }
    selAff.innerHTML = '<option value="">Chargement…</option>';
    try {
      const r = await Api.get('/classes/' + classeId + '/affectations');
      const aff = r.data || [];
      if (!aff.length) {
        selAff.innerHTML = '<option value="">Aucune affectation pour cette classe</option>';
        return;
      }
      selAff.innerHTML = '<option value="">— Choisir matière/enseignant —</option>' +
        aff.map(function(a: any) {
          return '<option value="' + escapeHtml(String(a.affectation_id || '')) + '">' +
            escapeHtml(a.matiere || '') + ' · ' + escapeHtml(a.enseignant_prenom || '') + ' ' + escapeHtml(a.enseignant_nom || '') +
          '</option>';
        }).join('');
    } catch (e: any) {
      selAff.innerHTML = '<option value="">Erreur de chargement</option>';
    }
  },

  async creerEvaluation() {
    const affId     = (document.getElementById('ev-affectation') as HTMLSelectElement | null)?.value || '';
    const periodeId = (document.getElementById('ev-periode')     as HTMLSelectElement | null)?.value || '';
    const type      = (document.getElementById('ev-type')        as HTMLSelectElement | null)?.value || '';
    const numero    = parseInt((document.getElementById('ev-numero')   as HTMLInputElement | null)?.value || '1') || 1;
    const titre     = ((document.getElementById('ev-titre')      as HTMLInputElement | null)?.value || '').trim();
    const noteMax   = parseFloat((document.getElementById('ev-note-max') as HTMLInputElement | null)?.value || '20') || 20;
    const date      = (document.getElementById('ev-date')        as HTMLInputElement | null)?.value || '';

    if (!affId)     return toast('Sélectionnez une matière / enseignant', 'w');
    if (!periodeId) return toast('Sélectionnez une période', 'w');
    if (!type)      return toast('Sélectionnez un type', 'w');

    const btn = document.getElementById('btn-creer-eval') as HTMLButtonElement | null;
    if (btn) { btn.disabled = true; btn.textContent = 'Création…'; }

    try {
      const payload: Record<string, any> = {
        affectation_id: affId,
        periode_id:     periodeId,
        type,
        numero,
        note_max:       noteMax,
      };
      if (titre) payload['titre'] = titre;
      if (date)  payload['date_evaluation'] = date;

      await Api.post('/evaluations', payload);
      closeModal('m-evaluation');
      toast('Évaluation créée — vous pouvez maintenant saisir les notes', 's');
      await this.charger();
    } catch (e: any) {
      toast(e.message || 'Erreur de création', 'e');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Créer l\'évaluation'; }
    }
  },

  // ── Saisie des notes ─────────────────────────────────────────────
  async ouvrirSaisie(evalId: string) {
    this._evalCourant = { id: evalId };

    // Titre calculé depuis les données locales (évite d'injecter des données API dans onclick)
    const evalMeta = (PageNotes.data || []).find(function(e: any) { return e.id === evalId; });
    const titre = evalMeta
      ? (evalMeta.titre || ((evalMeta.type || '') + ' ' + (evalMeta.numero || '') + ' — ' + (evalMeta.classe || '')))
      : 'Saisie des notes';

    const titreEl = document.getElementById('notes-modal-titre') as HTMLElement | null;
    if (titreEl) titreEl.textContent = titre;

    const tbody = document.getElementById('tb-notes-saisie') as HTMLElement | null;
    if (tbody) tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:30px;color:var(--g400)">Chargement…</td></tr>';

    openModal('m-notes');

    try {
      // Charger les notes existantes et la liste des élèves en parallèle
      const evalRes  = await Api.get('/evaluations/' + evalId + '/notes');
      const notesSaisies = evalRes.data || [];

      // Construire un map utilisateur_id → note existante
      // (utilisateur_id est l'id retourné par /classes/:id/eleves)
      const notesMap: Record<string, any> = {};
      notesSaisies.forEach(function(n: any) { notesMap[n.utilisateur_id || n.eleve_id] = n; });

      // Récupérer la classe depuis la data locale
      const evalInfo = (PageNotes.data || []).find(function(e: any) { return e.id === evalId; });
      PageNotes._evalCourant.note_max  = evalInfo ? evalInfo.note_max  : 20;
      PageNotes._evalCourant.statut    = evalInfo ? evalInfo.statut    : 'non_saisie';
      PageNotes._evalCourant.classe_id = evalInfo ? evalInfo.classe_id : null;

      const elevesRes = evalInfo && evalInfo.classe_id
        ? await Api.get('/classes/' + evalInfo.classe_id + '/eleves')
        : { data: [] };
      let eleves: any[] = elevesRes.data || [];

      // Si pas d'élèves mais des notes saisies, utiliser les notes
      if (!eleves.length && notesSaisies.length) {
        eleves = notesSaisies.map(function(n: any) {
          return { id: n.eleve_id, nom: n.nom, prenom: n.prenom, inscription_id: n.inscription_id || '' };
        });
      }

      PageNotes._renderGrille(eleves, notesMap, PageNotes._evalCourant.note_max);

      // Gérer les boutons selon le statut
      const btnPublier = document.getElementById('btn-publier-notes') as HTMLElement | null;
      const btnSauver  = document.getElementById('btn-sauver-notes')  as HTMLElement | null;
      const estPubliee = PageNotes._evalCourant.statut === 'publiee';
      if (btnPublier) btnPublier.style.display = estPubliee ? 'none' : '';
      if (btnSauver)  btnSauver.style.display  = estPubliee ? 'none' : '';

    } catch (e: any) {
      if (tbody) tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:30px;color:var(--rouge)">Erreur : ' + escapeHtml(e.message || 'impossible de charger les notes') + '</td></tr>';
    }
  },

  _renderGrille(eleves: any[], notesMap: Record<string, any>, noteMax: number) {
    const tbody = document.getElementById('tb-notes-saisie') as HTMLElement | null;
    if (!tbody) return;

    if (!eleves.length) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:30px;color:var(--g400)">Aucun élève inscrit dans cette classe</td></tr>';
      return;
    }

    tbody.innerHTML = eleves.map(function(el: any, i: number) {
      const note = notesMap[el.id] || {};
      const absent = note.est_absent || false;
      return '<tr id="nr-' + i + '">' +
        '<td><span style="font-weight:600">' + escapeHtml(el.nom || '') + '</span> ' + escapeHtml(el.prenom || '') +
          '<input type="hidden" class="nr-eleve-id"    value="' + escapeHtml(String(el.id || '')) + '">' +
          '<input type="hidden" class="nr-inscription" value="' + escapeHtml(String(el.inscription_id || '')) + '">' +
        '</td>' +
        '<td style="text-align:center">' +
          '<input type="checkbox" class="nr-absent" ' + (absent ? 'checked' : '') +
            ' onchange="PageNotes._toggleAbsent(this,' + i + ')">' +
        '</td>' +
        '<td>' +
          '<input type="number" class="fi nr-valeur" min="0" max="' + noteMax + '" step="0.5"' +
            ' value="' + (note.valeur != null ? note.valeur : '') + '"' +
            ' placeholder="/'+noteMax+'" ' + (absent ? 'disabled' : '') +
            ' style="width:90px;padding:4px 8px;font-size:13px">' +
        '</td>' +
        '<td>' +
          '<input type="text" class="fi nr-appreciation" placeholder="Appréciation…"' +
            ' value="' + (note.appreciation || '') + '"' +
            ' style="font-size:12px;padding:4px 8px">' +
        '</td>' +
      '</tr>';
    }).join('');
  },

  _toggleAbsent(checkbox: HTMLInputElement, i: number) {
    const row = document.getElementById('nr-' + i);
    if (!row) return;
    const inputNote = row.querySelector('.nr-valeur') as HTMLInputElement | null;
    if (inputNote) {
      inputNote.disabled = checkbox.checked;
      if (checkbox.checked) inputNote.value = '';
    }
  },

  async sauvegarderNotes() {
    const eval_ = this._evalCourant;
    if (!eval_) return;

    const rows = document.querySelectorAll('#tb-notes-saisie tr[id^="nr-"]');
    const notes: Record<string, any>[] = [];
    rows.forEach(function(row: Element) {
      const eleveId       = (row.querySelector('.nr-eleve-id')     as HTMLInputElement | null)?.value;
      const inscriptionId = (row.querySelector('.nr-inscription')  as HTMLInputElement | null)?.value;
      const absent        = (row.querySelector('.nr-absent')       as HTMLInputElement | null)?.checked || false;
      const valeurRaw     = (row.querySelector('.nr-valeur')       as HTMLInputElement | null)?.value;
      const appreciation  = ((row.querySelector('.nr-appreciation') as HTMLInputElement | null)?.value || '').trim() || undefined;
      const valeur        = valeurRaw !== '' && valeurRaw != null ? parseFloat(valeurRaw) : null;

      if (eleveId) {
        notes.push({
          eleve_id:          eleveId,
          inscription_id:    inscriptionId,
          est_absent:        absent,
          absence_justifiee: false,
          valeur,
          appreciation,
        });
      }
    });

    if (!notes.length) return toast('Aucune note à enregistrer', 'w');

    const btn = document.getElementById('btn-sauver-notes') as HTMLButtonElement | null;
    if (btn) { btn.disabled = true; btn.textContent = 'Enregistrement…'; }

    try {
      await Api.put('/evaluations/' + eval_.id + '/notes', { notes });
      toast(notes.length + ' notes enregistrées ✓', 's');
      await this.charger();
    } catch (e: any) {
      toast(e.message || 'Erreur d\'enregistrement', 'e');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Enregistrer'; }
    }
  },

  async publierNotes() {
    const eval_ = this._evalCourant;
    if (!eval_) return;

    if (!confirm('Publier les notes ? Les parents seront notifiés par SMS/WhatsApp.')) return;

    const btn = document.getElementById('btn-publier-notes') as HTMLButtonElement | null;
    if (btn) { btn.disabled = true; btn.textContent = 'Publication…'; }

    try {
      // Sauvegarder d'abord, puis publier
      await PageNotes.sauvegarderNotes();
      await Api.put('/evaluations/' + eval_.id + '/publier', {});
      toast('Notes publiées — parents notifiés 📱', 's');
      closeModal('m-notes');
      await this.charger();
    } catch (e: any) {
      toast(e.message || 'Erreur de publication', 'e');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Publier'; }
    }
  },
};

(window as any).PageNotes = PageNotes;
PAGE_HOOKS['notes'] = () => PageNotes.init();
