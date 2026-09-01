'use strict';

var PageNotes = {
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
      var r = await Api.get('/annees-scolaires/courante');
      this._periodes = (r.data && r.data.periodes) || [];
    } catch (e) { this._periodes = []; }
  },

  async _chargerClasses() {
    try {
      var r = await Api.get('/classes');
      this._classes = r.data || [];
    } catch (e) { this._classes = []; }
  },

  _peuplerFiltres() {
    var selClasse = document.getElementById('fil-notes-classe');
    var selPeriode = document.getElementById('fil-notes-periode');
    if (selClasse) {
      selClasse.innerHTML = '<option value="">Toutes les classes</option>' +
        this._classes.map(function(c) {
          return '<option value="' + c.id + '">' + c.nom_classe + '</option>';
        }).join('');
    }
    if (selPeriode) {
      selPeriode.innerHTML = '<option value="">Toutes les périodes</option>' +
        this._periodes.map(function(p) {
          return '<option value="' + p.id + '">' + p.libelle + '</option>';
        }).join('');
    }
  },

  // ── Chargement des évaluations ───────────────────────────────────
  async charger() {
    try {
      var params = '';
      var classeId  = document.getElementById('fil-notes-classe')?.value;
      var periodeId = document.getElementById('fil-notes-periode')?.value;
      if (classeId)  params += (params ? '&' : '?') + 'classe_id='  + classeId;
      if (periodeId) params += (params ? '&' : '?') + 'periode_id=' + periodeId;

      var res = await Api.get('/evaluations' + params);
      this.data = res.data || [];
      this.renderTable(this.data);
    } catch (e) {
      console.warn('PageNotes: erreur chargement —', e.message);
      this.data = [];
      this.renderTable([]);
    }
  },

  // ── Affichage du tableau ─────────────────────────────────────────
  renderTable(evals) {
    var tbody = document.getElementById('tb-eval');
    if (!tbody) return;

    if (!evals.length) {
      tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;color:var(--g400);padding:30px">Aucune évaluation — créez-en une avec "+ Nouvelle évaluation"</td></tr>';
      return;
    }

    tbody.innerHTML = evals.map(function(ev) {
      var moy = ev.moyenne_classe != null ? ev.moyenne_classe : null;
      var st  = ev.statut || 'non_saisie';
      var stBadge = st === 'publiee'
        ? '<span class="badge bs">Publiée</span>'
        : st === 'brouillon'
          ? '<span class="badge bw">Brouillon</span>'
          : '<span class="badge bd">Non saisie</span>';

      var matiere    = escapeHtml(ev.matiere || '—');
      var classe     = escapeHtml(ev.classe  || '—');
      var typeLabel  = escapeHtml(ev.type    || '—');
      var date       = escapeHtml(ev.date_evaluation || '—');
      var enseignant = escapeHtml(ev.enseignant || '—');

      // Passer uniquement l'id (UUID safe) — le titre est calculé dans ouvrirSaisie()
      var actions = st !== 'publiee'
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
    var selClasse = document.getElementById('ev-classe');
    if (selClasse) {
      selClasse.innerHTML = '<option value="">— Choisir une classe —</option>' +
        this._classes.map(function(c) {
          return '<option value="' + c.id + '">' + c.nom_classe + '</option>';
        }).join('');
      // reset affectations
      var selAff = document.getElementById('ev-affectation');
      if (selAff) selAff.innerHTML = '<option value="">— Sélectionnez d\'abord une classe —</option>';
    }
    // Remplir le select période
    var selPer = document.getElementById('ev-periode');
    if (selPer) {
      selPer.innerHTML = this._periodes.map(function(p) {
        return '<option value="' + p.id + '">' + p.libelle + '</option>';
      }).join('');
    }
    openModal('m-evaluation');
  },

  async onClasseChangeEval() {
    var classeId = document.getElementById('ev-classe')?.value;
    var selAff   = document.getElementById('ev-affectation');
    if (!selAff) return;
    if (!classeId) {
      selAff.innerHTML = '<option value="">— Sélectionnez d\'abord une classe —</option>';
      return;
    }
    selAff.innerHTML = '<option value="">Chargement…</option>';
    try {
      var r = await Api.get('/classes/' + classeId + '/affectations');
      var aff = r.data || [];
      if (!aff.length) {
        selAff.innerHTML = '<option value="">Aucune affectation pour cette classe</option>';
        return;
      }
      selAff.innerHTML = '<option value="">— Choisir matière/enseignant —</option>' +
        aff.map(function(a) {
          return '<option value="' + escapeHtml(String(a.affectation_id || '')) + '">' +
            escapeHtml(a.matiere || '') + ' · ' + escapeHtml(a.enseignant_prenom || '') + ' ' + escapeHtml(a.enseignant_nom || '') +
          '</option>';
        }).join('');
    } catch (e) {
      selAff.innerHTML = '<option value="">Erreur de chargement</option>';
    }
  },

  async creerEvaluation() {
    var affId    = document.getElementById('ev-affectation')?.value;
    var periodeId = document.getElementById('ev-periode')?.value;
    var type     = document.getElementById('ev-type')?.value;
    var numero   = parseInt(document.getElementById('ev-numero')?.value) || 1;
    var titre    = document.getElementById('ev-titre')?.value?.trim();
    var noteMax  = parseFloat(document.getElementById('ev-note-max')?.value) || 20;
    var date     = document.getElementById('ev-date')?.value;

    if (!affId)     return toast('Sélectionnez une matière / enseignant', 'w');
    if (!periodeId) return toast('Sélectionnez une période', 'w');
    if (!type)      return toast('Sélectionnez un type', 'w');

    var btn = document.getElementById('btn-creer-eval');
    if (btn) { btn.disabled = true; btn.textContent = 'Création…'; }

    try {
      var payload = {
        affectation_id:  affId,
        periode_id:      periodeId,
        type:            type,
        numero:          numero,
        note_max:        noteMax,
      };
      if (titre) payload.titre = titre;
      if (date)  payload.date_evaluation = date;

      await Api.post('/evaluations', payload);
      closeModal('m-evaluation');
      toast('Évaluation créée — vous pouvez maintenant saisir les notes', 's');
      await this.charger();
    } catch (e) {
      toast(e.message || 'Erreur de création', 'e');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Créer l\'évaluation'; }
    }
  },

  // ── Saisie des notes ─────────────────────────────────────────────
  async ouvrirSaisie(evalId) {
    this._evalCourant = { id: evalId };

    // Titre calculé depuis les données locales (évite d'injecter des données API dans onclick)
    var evalMeta = (PageNotes.data || []).find(function(e) { return e.id === evalId; });
    var titre = evalMeta
      ? (evalMeta.titre || ((evalMeta.type || '') + ' ' + (evalMeta.numero || '') + ' \u2014 ' + (evalMeta.classe || '')))
      : 'Saisie des notes';

    var titreEl = document.getElementById('notes-modal-titre');
    if (titreEl) titreEl.textContent = titre;

    var tbody = document.getElementById('tb-notes-saisie');
    if (tbody) tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:30px;color:var(--g400)">Chargement…</td></tr>';

    openModal('m-notes');

    try {
      // Charger les notes existantes et la liste des élèves en parallèle
      var evalRes  = await Api.get('/evaluations/' + evalId + '/notes');
      var notesSaisies = evalRes.data || [];

      // Construire un map utilisateur_id → note existante
      // (utilisateur_id est l'id retourné par /classes/:id/eleves)
      var notesMap = {};
      notesSaisies.forEach(function(n) { notesMap[n.utilisateur_id || n.eleve_id] = n; });

      // Récupérer la classe depuis la data locale
      var evalInfo = (PageNotes.data || []).find(function(e) { return e.id === evalId; });
      PageNotes._evalCourant.note_max  = evalInfo ? evalInfo.note_max  : 20;
      PageNotes._evalCourant.statut    = evalInfo ? evalInfo.statut    : 'non_saisie';
      PageNotes._evalCourant.classe_id = evalInfo ? evalInfo.classe_id : null;

      var elevesRes = evalInfo && evalInfo.classe_id
        ? await Api.get('/classes/' + evalInfo.classe_id + '/eleves')
        : { data: [] };
      var eleves = elevesRes.data || [];

      // Si pas d'élèves mais des notes saisies, utiliser les notes
      if (!eleves.length && notesSaisies.length) {
        eleves = notesSaisies.map(function(n) {
          return { id: n.eleve_id, nom: n.nom, prenom: n.prenom, inscription_id: n.inscription_id || '' };
        });
      }

      PageNotes._renderGrille(eleves, notesMap, PageNotes._evalCourant.note_max);

      // Gérer les boutons selon le statut
      var btnPublier = document.getElementById('btn-publier-notes');
      var btnSauver  = document.getElementById('btn-sauver-notes');
      var estPubliee = PageNotes._evalCourant.statut === 'publiee';
      if (btnPublier) btnPublier.style.display = estPubliee ? 'none' : '';
      if (btnSauver)  btnSauver.style.display  = estPubliee ? 'none' : '';

    } catch (e) {
      if (tbody) tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:30px;color:var(--rouge)">Erreur : ' + escapeHtml(e.message || 'impossible de charger les notes') + '</td></tr>';
    }
  },

  _renderGrille(eleves, notesMap, noteMax) {
    var tbody = document.getElementById('tb-notes-saisie');
    if (!tbody) return;

    if (!eleves.length) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:30px;color:var(--g400)">Aucun élève inscrit dans cette classe</td></tr>';
      return;
    }

    tbody.innerHTML = eleves.map(function(el, i) {
      var note = notesMap[el.id] || {};
      var absent = note.est_absent || false;
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

  _toggleAbsent(checkbox, i) {
    var row = document.getElementById('nr-' + i);
    if (!row) return;
    var inputNote = row.querySelector('.nr-valeur');
    if (inputNote) {
      inputNote.disabled = checkbox.checked;
      if (checkbox.checked) inputNote.value = '';
    }
  },

  async sauvegarderNotes() {
    var eval_ = this._evalCourant;
    if (!eval_) return;

    var rows = document.querySelectorAll('#tb-notes-saisie tr[id^="nr-"]');
    var notes = [];
    rows.forEach(function(row) {
      var eleveId      = row.querySelector('.nr-eleve-id')?.value;
      var inscriptionId = row.querySelector('.nr-inscription')?.value;
      var absent       = row.querySelector('.nr-absent')?.checked || false;
      var valeurRaw    = row.querySelector('.nr-valeur')?.value;
      var appreciation = row.querySelector('.nr-appreciation')?.value?.trim() || undefined;
      var valeur       = valeurRaw !== '' ? parseFloat(valeurRaw) : null;

      if (eleveId) {
        notes.push({
          eleve_id:          eleveId,
          inscription_id:    inscriptionId,
          est_absent:        absent,
          absence_justifiee: false,
          valeur:            valeur,
          appreciation:      appreciation,
        });
      }
    });

    if (!notes.length) return toast('Aucune note à enregistrer', 'w');

    var btn = document.getElementById('btn-sauver-notes');
    if (btn) { btn.disabled = true; btn.textContent = 'Enregistrement…'; }

    try {
      await Api.put('/evaluations/' + eval_.id + '/notes', { notes: notes });
      toast(notes.length + ' notes enregistrées ✓', 's');
      await this.charger();
    } catch (e) {
      toast(e.message || 'Erreur d\'enregistrement', 'e');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Enregistrer'; }
    }
  },

  async publierNotes() {
    var eval_ = this._evalCourant;
    if (!eval_) return;

    if (!confirm('Publier les notes ? Les parents seront notifiés par SMS/WhatsApp.')) return;

    var btn = document.getElementById('btn-publier-notes');
    if (btn) { btn.disabled = true; btn.textContent = 'Publication…'; }

    try {
      // Sauvegarder d'abord, puis publier
      await PageNotes.sauvegarderNotes();
      await Api.put('/evaluations/' + eval_.id + '/publier', {});
      toast('Notes publiées — parents notifiés 📱', 's');
      closeModal('m-notes');
      await this.charger();
    } catch (e) {
      toast(e.message || 'Erreur de publication', 'e');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Publier'; }
    }
  },
};

PAGE_HOOKS.notes = function() { PageNotes.init(); };
