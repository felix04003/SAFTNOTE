'use strict';

var PageEnsNotes = {
  _data: [],
  _classes: [],      // [{classe_id, classe, affectation_id, matiere}]
  _periodes: [],
  _evalCourant: null,
  _filtreClasseId: '',
  _filtreStatut: '',

  async init() {
    await Promise.all([this._chargerClasses(), this._chargerPeriodes()]);
    this._peuplerFiltreClasses();
    await this.charger();
  },

  async _chargerClasses() {
    try {
      var res = await Api.get('/enseignants/moi/classes');
      this._classes = res.data || [];
    } catch (e) { this._classes = []; }
  },

  async _chargerPeriodes() {
    try {
      var r = await Api.get('/annees-scolaires/courante');
      this._periodes = (r.data && r.data.periodes) || [];
    } catch (e) { this._periodes = []; }
  },

  _peuplerFiltreClasses() {
    var sel = document.getElementById('ens-fil-classe');
    if (!sel) return;
    // Dédupliquer les classes (un enseignant peut avoir plusieurs matières dans une même classe)
    var vues = {};
    var classes = this._classes.filter(function(c) {
      if (vues[c.classe_id]) return false;
      vues[c.classe_id] = true;
      return true;
    });
    sel.innerHTML = '<option value="">Toutes mes classes</option>' +
      classes.map(function(c) {
        return '<option value="' + c.classe_id + '">' + c.classe + '</option>';
      }).join('');
    if (PageEnsNotes._filtreClasseId) sel.value = PageEnsNotes._filtreClasseId;
  },

  // Appelé depuis ens-classes (raccourci) — DOIT être suivi d'une navigation goto('ens-notes')
  // Le filtre est appliqué lors du prochain init() (charger() + _peuplerFiltreClasses())
  filtrerParClasse: function(classeId) {
    this._filtreClasseId = classeId;
  },

  filtrerClasse: function(classeId) { this._filtreClasseId = classeId; this.charger(); },
  filtrerStatut: function(statut) { this._filtreStatut = statut; this.charger(); },

  async charger() {
    var tbody = document.getElementById('tb-ens-eval');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--g400)">Chargement\u2026</td></tr>';

    try {
      var params = {};
      if (this._filtreClasseId) params.classe_id = this._filtreClasseId;
      if (this._filtreStatut)   params.statut = this._filtreStatut;

      var res = await Api.get('/evaluations', params);
      this._data = res.data || [];
      this._renderTable(this._data);
    } catch (e) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--rouge)">' + (e.message || 'Erreur de chargement') + '</td></tr>';
    }
  },

  _renderTable: function(evals) {
    var tbody = document.getElementById('tb-ens-eval');
    if (!tbody) return;

    if (!evals.length) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--g400);padding:30px">Aucune \u00e9valuation \u2014 cr\u00e9ez-en une avec \u201c+ Nouvelle \u00e9valuation\u201d</td></tr>';
      return;
    }

    tbody.innerHTML = evals.map(function(ev) {
      var moy = ev.moyenne_classe != null ? ev.moyenne_classe : null;
      var st = ev.statut || 'non_saisie';
      var badge = st === 'publiee'
        ? '<span class="badge bs">Publi\u00e9e</span>'
        : st === 'brouillon'
          ? '<span class="badge bw">Brouillon</span>'
          : '<span class="badge bd">\u00c0 saisir</span>';

      var titre = (ev.titre || (ev.type + ' ' + (ev.numero || ''))) + ' \u2014 ' + (ev.classe || '');
      var titreEsc = (titre || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;');

      return '<tr style="cursor:pointer" onclick="PageEnsNotes.ouvrirSaisie(\'' + ev.id + '\',\'' + titreEsc + '\')">' +
        '<td class="nc">' + (ev.matiere || '\u2014') + '</td>' +
        '<td><span class="badge bp">' + (ev.classe || '\u2014') + '</span></td>' +
        '<td><span class="badge bo">' + (ev.type || '\u2014') + '</span></td>' +
        '<td style="font-family:\'Space Mono\',monospace;font-size:11.5px">' + (ev.date_evaluation || '\u2014') + '</td>' +
        '<td>' + (moy != null ? '<span style="font-weight:700;color:' + cn(moy) + '">' + moy + '/20</span>' : '<span class="badge bd">\u2014</span>') + '</td>' +
        '<td>' + badge + '</td>' +
        '<td onclick="event.stopPropagation()">' +
          (st !== 'publiee'
            ? '<button class="btn btn-l btn-sm" onclick="event.stopPropagation();PageEnsNotes.ouvrirSaisie(\'' + ev.id + '\',\'' + titreEsc + '\')">&#x270f;&#xfe0f; Saisir</button>'
            : '<button class="btn btn-sm" style="background:var(--g100);color:var(--g500);cursor:default">&#x1f441; Voir</button>') +
        '</td>' +
      '</tr>';
    }).join('');
  },

  // ── Modal création évaluation ────────────────────────────────────
  ouvrirModalEval: async function() {
    var selClasse = document.getElementById('ens-ev-classe');
    if (selClasse) {
      // Dédupliquer les classes
      var vues = {};
      var classes = this._classes.filter(function(c) {
        if (vues[c.classe_id]) return false;
        vues[c.classe_id] = true;
        return true;
      });
      selClasse.innerHTML = '<option value="">\u2014 Choisir une classe \u2014</option>' +
        classes.map(function(c) {
          return '<option value="' + c.classe_id + '">' + c.classe + '</option>';
        }).join('');
      // Reset affectations
      var selAff = document.getElementById('ens-ev-affectation');
      if (selAff) selAff.innerHTML = '<option value="">\u2014 S\u00e9lectionnez d\'abord une classe \u2014</option>';
    }
    var selPer = document.getElementById('ens-ev-periode');
    if (selPer) {
      selPer.innerHTML = this._periodes.map(function(p) {
        return '<option value="' + p.id + '">' + p.libelle + '</option>';
      }).join('');
    }
    openModal('m-ens-evaluation');
  },

  onClasseChangeEval: async function() {
    var classeEl = document.getElementById('ens-ev-classe');
    var classeId = classeEl ? classeEl.value : '';
    var selAff = document.getElementById('ens-ev-affectation');
    if (!selAff) return;
    if (!classeId) {
      selAff.innerHTML = '<option value="">\u2014 S\u00e9lectionnez d\'abord une classe \u2014</option>';
      return;
    }
    // Filtrer les affectations de cet enseignant pour cette classe
    var aff = this._classes.filter(function(c) { return c.classe_id === classeId; });
    if (aff.length) {
      selAff.innerHTML = '<option value="">\u2014 Choisir la mati\u00e8re \u2014</option>' +
        aff.map(function(a) {
          return '<option value="' + a.affectation_id + '">' + a.matiere + '</option>';
        }).join('');
    } else {
      selAff.innerHTML = '<option value="">Aucune affectation pour cette classe</option>';
    }
  },

  creerEvaluation: async function() {
    var affEl    = document.getElementById('ens-ev-affectation');
    var perEl    = document.getElementById('ens-ev-periode');
    var typeEl   = document.getElementById('ens-ev-type');
    var numEl    = document.getElementById('ens-ev-numero');
    var titreEl  = document.getElementById('ens-ev-titre');
    var maxEl    = document.getElementById('ens-ev-note-max');
    var dateEl   = document.getElementById('ens-ev-date');

    var affId     = affEl ? affEl.value : '';
    var periodeId = perEl ? perEl.value : '';
    var type      = typeEl ? typeEl.value : '';
    var numero    = numEl ? (parseInt(numEl.value) || 1) : 1;
    var titre     = titreEl ? titreEl.value.trim() : '';
    var noteMax   = maxEl ? (parseFloat(maxEl.value) || 20) : 20;
    var date      = dateEl ? dateEl.value : '';

    if (!affId)     return toast('S\u00e9lectionnez une mati\u00e8re', 'w');
    if (!periodeId) return toast('S\u00e9lectionnez une p\u00e9riode', 'w');
    if (!type)      return toast('S\u00e9lectionnez un type', 'w');

    var btn = document.getElementById('btn-ens-creer-eval');
    if (btn) { btn.disabled = true; btn.textContent = 'Cr\u00e9ation\u2026'; }

    try {
      var payload = { affectation_id: affId, periode_id: periodeId, type: type, numero: numero, note_max: noteMax };
      if (titre) payload.titre = titre;
      if (date)  payload.date_evaluation = date;

      await Api.post('/evaluations', payload);
      closeModal('m-ens-evaluation');
      toast('\u00c9valuation cr\u00e9\u00e9e \u2713 \u2014 vous pouvez maintenant saisir les notes', 's');
      await this.charger();
    } catch (e) {
      toast(e.message || 'Erreur de cr\u00e9ation', 'e');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Cr\u00e9er l\'évaluation'; }
    }
  },

  // ── Modal saisie des notes ────────────────────────────────────────
  ouvrirSaisie: async function(evalId, titre) {
    this._evalCourant = { id: evalId, titre: titre };

    var titreEl = document.getElementById('ens-notes-modal-titre');
    if (titreEl) titreEl.textContent = titre || 'Saisie des notes';

    var tbody = document.getElementById('tb-ens-notes-saisie');
    if (tbody) tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:30px;color:var(--g400)">Chargement\u2026</td></tr>';

    openModal('m-ens-notes');

    try {
      var evalRes = await Api.get('/evaluations/' + evalId + '/notes');
      var notesSaisies = evalRes.data || [];
      var notesMap = {};
      notesSaisies.forEach(function(n) { notesMap[n.eleve_id] = n; });

      // Si _data est vide (navigation directe depuis le dashboard), charger les évals d'abord
      if (!PageEnsNotes._data || !PageEnsNotes._data.length) {
        await PageEnsNotes.charger();
      }
      var evalInfo = null;
      for (var i = 0; i < (PageEnsNotes._data || []).length; i++) {
        if (PageEnsNotes._data[i].id === evalId) { evalInfo = PageEnsNotes._data[i]; break; }
      }

      PageEnsNotes._evalCourant.note_max  = evalInfo ? evalInfo.note_max  : 20;
      PageEnsNotes._evalCourant.statut    = evalInfo ? evalInfo.statut    : 'non_saisie';
      PageEnsNotes._evalCourant.classe_id = evalInfo ? evalInfo.classe_id : null;

      var eleves = [];
      if (evalInfo && evalInfo.classe_id) {
        var elevesRes = await Api.get('/classes/' + evalInfo.classe_id + '/eleves');
        eleves = elevesRes.data || [];
      }
      if (!eleves.length && notesSaisies.length) {
        eleves = notesSaisies.map(function(n) {
          return { id: n.eleve_id, nom: n.nom, prenom: n.prenom, inscription_id: n.inscription_id || '' };
        });
      }

      PageEnsNotes._renderGrille(eleves, notesMap, PageEnsNotes._evalCourant.note_max);

      var estPubliee = PageEnsNotes._evalCourant.statut === 'publiee';
      var btnPublier = document.getElementById('btn-ens-publier-notes');
      var btnSauver  = document.getElementById('btn-ens-sauver-notes');
      if (btnPublier) btnPublier.style.display = estPubliee ? 'none' : '';
      if (btnSauver)  btnSauver.style.display  = estPubliee ? 'none' : '';

    } catch (e) {
      if (tbody) tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:30px;color:var(--rouge)">Erreur\u00a0: ' + (e.message || '') + '</td></tr>';
    }
  },

  _renderGrille: function(eleves, notesMap, noteMax) {
    var tbody = document.getElementById('tb-ens-notes-saisie');
    if (!tbody) return;
    if (!eleves.length) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:30px;color:var(--g400)">Aucun \u00e9l\u00e8ve</td></tr>';
      return;
    }
    tbody.innerHTML = eleves.map(function(el, i) {
      var note = notesMap[el.id] || {};
      var absent = note.est_absent || false;
      return '<tr id="nr-' + i + '">' +
        '<td><span style="font-weight:600">' + (el.nom || '') + '</span> ' + (el.prenom || '') +
          '<input type="hidden" class="nr-eleve-id" value="' + (el.id || '') + '">' +
          '<input type="hidden" class="nr-inscription" value="' + (el.inscription_id || '') + '">' +
        '</td>' +
        '<td style="text-align:center"><input type="checkbox" class="nr-absent" ' + (absent ? 'checked' : '') +
          ' onchange="PageEnsNotes._toggleAbsent(this,' + i + ')"></td>' +
        '<td><input type="number" class="fi nr-valeur" min="0" max="' + noteMax + '" step="0.5"' +
          ' value="' + (note.valeur != null ? note.valeur : '') + '"' +
          ' placeholder="/' + noteMax + '" ' + (absent ? 'disabled' : '') +
          ' style="width:90px;padding:4px 8px;font-size:13px"></td>' +
        '<td><input type="text" class="fi nr-appreciation" placeholder="Appr\u00e9ciation\u2026"' +
          ' value="' + ((note.appreciation || '')).replace(/"/g, '&quot;') + '"' +
          ' style="font-size:12px;padding:4px 8px"></td>' +
      '</tr>';
    }).join('');
  },

  _toggleAbsent: function(checkbox, i) {
    var row = document.getElementById('nr-' + i);
    if (!row) return;
    var input = row.querySelector('.nr-valeur');
    if (input) { input.disabled = checkbox.checked; if (checkbox.checked) input.value = ''; }
  },

  sauvegarderNotes: async function() {
    var ev = this._evalCourant;
    if (!ev) return;

    var rows = document.querySelectorAll('#tb-ens-notes-saisie tr[id^="nr-"]');
    var notes = [];
    rows.forEach(function(row) {
      var eleveIdEl      = row.querySelector('.nr-eleve-id');
      var inscriptionIdEl = row.querySelector('.nr-inscription');
      var absentEl       = row.querySelector('.nr-absent');
      var valeurEl       = row.querySelector('.nr-valeur');
      var appreciationEl = row.querySelector('.nr-appreciation');

      var eleveId       = eleveIdEl ? eleveIdEl.value : '';
      var inscriptionId = inscriptionIdEl ? inscriptionIdEl.value : '';
      var absent        = absentEl ? absentEl.checked : false;
      var valeurRaw     = valeurEl ? valeurEl.value : '';
      var appreciation  = (appreciationEl && appreciationEl.value.trim()) ? appreciationEl.value.trim() : undefined;
      var valeur        = valeurRaw !== '' ? parseFloat(valeurRaw) : null;

      if (eleveId) notes.push({ eleve_id: eleveId, inscription_id: inscriptionId, est_absent: absent, absence_justifiee: false, valeur: valeur, appreciation: appreciation });
    });

    if (!notes.length) return toast('Aucune note \u00e0 enregistrer', 'w');

    var btn = document.getElementById('btn-ens-sauver-notes');
    if (btn) { btn.disabled = true; btn.textContent = 'Enregistrement\u2026'; }

    try {
      await Api.put('/evaluations/' + ev.id + '/notes', { notes: notes });
      toast(notes.length + ' notes enregistr\u00e9es \u2713', 's');
      await PageEnsNotes.charger();
    } catch (e) {
      toast(e.message || 'Erreur d\'enregistrement', 'e');
      throw e;
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Enregistrer'; }
    }
  },

  publierNotes: async function() {
    var ev = this._evalCourant;
    if (!ev) return;
    if (!confirm('Publier les notes\u00a0? Les parents seront notifi\u00e9s par SMS/WhatsApp.')) return;

    var btn = document.getElementById('btn-ens-publier-notes');
    if (btn) { btn.disabled = true; btn.textContent = 'Publication\u2026'; }

    try {
      await PageEnsNotes.sauvegarderNotes();
      await Api.put('/evaluations/' + ev.id + '/publier', {});
      toast('Notes publi\u00e9es \u2014 parents notifi\u00e9s \ud83d\udcf1', 's');
      closeModal('m-ens-notes');
      await PageEnsNotes.charger();
    } catch (e) {
      toast(e.message || 'Erreur de publication', 'e');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '\ud83d\udcf1 Publier (notif parents)'; }
    }
  },
};

PAGE_HOOKS['ens-notes'] = function() { PageEnsNotes.init(); };
