'use strict';

var PageEnsAppel = {
  _appelId: null,
  _classeId: null,
  _eleves: [],
  _filtreClasseId: null,  // filtre pré-sélectionné depuis ens-classes

  async init() {
    // Date du jour dans le header
    var dateEl = document.getElementById('appel-date-aujourd-hui');
    if (dateEl) {
      var now = new Date();
      var opts = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
      dateEl.textContent = now.toLocaleDateString('fr-FR', opts);
    }

    // Reset état
    this._appelId = null;
    this._classeId = null;
    this._eleves = [];

    // Toujours afficher la liste des créneaux au (re)chargement
    this.retourCreneaux();
    await this._chargerCreneaux();
  },

  retourCreneaux() {
    var etapeCreneaux = document.getElementById('appel-etape-creneaux');
    var etapeGrille = document.getElementById('appel-etape-grille');
    if (etapeCreneaux) etapeCreneaux.style.display = '';
    if (etapeGrille) etapeGrille.style.display = 'none';
  },

  async _chargerCreneaux() {
    var liste = document.getElementById('appel-creneaux-liste');
    if (!liste) return;
    liste.innerHTML = '<div style="padding:20px;text-align:center;color:var(--g400)">Chargement\u2026</div>';

    try {
      var res = await Api.get('/enseignants/moi/edt');
      var edt = (res.data && res.data.emploi_du_temps) || [];

      // Jour de la semaine : JS 0=Dim,1=Lun... backend 1=Lun,6=Sam
      var jourJS = new Date().getDay(); // 0-6
      // Backend utilise 1=Lun,2=Mar,...,6=Sam (Dim=0 pas de cours)
      var jourEDT = jourJS;  // coïncide directement

      var jourAuj = edt.find(function(j) { return j.jour === jourEDT; });
      var creneaux = (jourAuj && jourAuj.creneaux) || [];
      creneaux = creneaux.filter(function(c) { return !c.est_pause; });

      // Si filtre classe pré-sélectionné (venu de ens-classes)
      if (this._filtreClasseId) {
        var filtreId = this._filtreClasseId;
        creneaux = creneaux.filter(function(c) { return c.classe_id === filtreId; });
        this._filtreClasseId = null;
      }

      if (!creneaux.length) {
        liste.innerHTML = '<div style="text-align:center;padding:32px;color:var(--g400)">' +
          '<div style="font-size:32px;margin-bottom:12px">\uD83C\uDF89</div>' +
          '<div style="font-weight:600;font-size:14px;color:var(--g500)">Pas de cours aujourd\'hui</div>' +
          '<div style="font-size:12px;margin-top:6px">Consultez votre <a onclick="goto(\'ens-edt\')" style="color:var(--vert-lt);cursor:pointer">emploi du temps</a> pour la semaine.</div>' +
        '</div>';
        return;
      }

      liste.innerHTML = creneaux.map(function(c) {
        return '<div style="display:flex;align-items:center;justify-content:space-between;padding:14px 0;border-bottom:1px solid var(--g100)">' +
          '<div>' +
            '<div style="font-weight:700;font-size:14px;color:var(--g900)">' + (c.matiere || '\u2014') + '</div>' +
            '<div style="font-size:12.5px;color:var(--g500);margin-top:3px">' +
              (c.classe || '') + ' \u00B7 ' + (c.heure_debut || '') + ' \u2013 ' + (c.heure_fin || '') +
              (c.salle ? ' \u00B7 <span style="color:var(--g400)">' + c.salle + '</span>' : '') +
            '</div>' +
          '</div>' +
          '<button class="btn btn-p" ' +
            'onclick="PageEnsAppel.selectionnerCreneau(\'' + c.creneau_id + '\',\'' + (c.matiere || '') + '\',\'' + (c.classe || '') + '\',\'' + (c.classe_id || '') + '\')">' +
            'Faire l\'appel \u2192' +
          '</button>' +
        '</div>';
      }).join('');

    } catch (e) {
      liste.innerHTML = '<div style="text-align:center;padding:28px;color:var(--rouge);font-size:13px">Impossible de charger les cr\u00E9neaux : ' + (e.message || '') + '</div>';
    }
  },

  // Appelé depuis le dashboard (bouton rapide)
  lancerDepuisCreneau(creneauId, matiere, classe, classeId) {
    goto('ens-appel');
    // Petit délai pour laisser la page s'afficher
    setTimeout(function() {
      PageEnsAppel.selectionnerCreneau(creneauId, matiere, classe, classeId);
    }, 200);
  },

  // Filtre pré-sélectionné depuis ens-classes
  filtrerParClasse(classeId) {
    this._filtreClasseId = classeId;
  },

  async selectionnerCreneau(creneauId, matiere, classe, classeId) {
    this._classeId = classeId;

    // Afficher la grille
    var etapeCreneaux = document.getElementById('appel-etape-creneaux');
    var etapeGrille = document.getElementById('appel-etape-grille');
    if (etapeCreneaux) etapeCreneaux.style.display = 'none';
    if (etapeGrille) etapeGrille.style.display = '';

    // Titre de la grille
    var titre = document.getElementById('appel-grille-titre');
    var sous = document.getElementById('appel-grille-sous');
    if (titre) titre.textContent = matiere + ' \u2014 ' + classe;
    if (sous) {
      var now = new Date();
      sous.textContent = now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    }

    // État du tableau
    var tbody = document.getElementById('tb-appel-grille');
    if (tbody) tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:30px;color:var(--g400)">Ouverture de l\'appel\u2026</td></tr>';

    try {
      // 1. Ouvrir l'appel (idempotent)
      var today = new Date().toISOString().split('T')[0];
      var res = await Api.post('/appels', {
        emploi_du_temps_id: creneauId,
        date_cours: today,
      });
      this._appelId = res.data && res.data.appel_id;

      // 2. Charger les élèves de la classe
      var elevesRes = await Api.get('/classes/' + classeId + '/eleves');
      this._eleves = elevesRes.data || [];

      var nbEl = document.getElementById('appel-grille-nb');
      if (nbEl) nbEl.textContent = this._eleves.length + ' \u00E9l\u00E8ve(s)';

      this._renderGrille(this._eleves);

    } catch (e) {
      if (tbody) tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:30px;color:var(--rouge)">Erreur : ' + (e.message || 'impossible d\'ouvrir l\'appel') + '</td></tr>';
    }
  },

  _renderGrille(eleves) {
    var tbody = document.getElementById('tb-appel-grille');
    if (!tbody) return;

    if (!eleves.length) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:30px;color:var(--g400)">Aucun \u00E9l\u00E8ve dans cette classe</td></tr>';
      return;
    }

    tbody.innerHTML = eleves.map(function(el, i) {
      var nom = (el.nom || '') + ' ' + (el.prenom || '');
      return '<tr id="ar-' + i + '">' +
        '<td style="font-weight:600">' + nom + '<input type="hidden" class="ar-inscr" value="' + (el.inscription_id || '') + '"></td>' +
        '<td style="text-align:center"><input type="radio" name="stat-' + i + '" class="ar-stat" value="present" checked onchange="PageEnsAppel._onStatChange(' + i + ')"></td>' +
        '<td style="text-align:center"><input type="radio" name="stat-' + i + '" class="ar-stat" value="absent" onchange="PageEnsAppel._onStatChange(' + i + ')"></td>' +
        '<td style="text-align:center"><input type="radio" name="stat-' + i + '" class="ar-stat" value="retard" onchange="PageEnsAppel._onStatChange(' + i + ')"></td>' +
        '<td><input type="number" class="fi ar-retard" min="1" max="120" placeholder="min" disabled style="width:72px;padding:3px 7px;font-size:12px"></td>' +
      '</tr>';
    }).join('');
  },

  _onStatChange(i) {
    var row = document.getElementById('ar-' + i);
    if (!row) return;
    var checkedRadio = row.querySelector('input[name="stat-' + i + '"]:checked');
    var stat = checkedRadio ? checkedRadio.value : null;
    var retardInput = row.querySelector('.ar-retard');
    if (retardInput) retardInput.disabled = (stat !== 'retard');
  },

  marquerTousPresents() {
    document.querySelectorAll('#tb-appel-grille tr').forEach(function(row, i) {
      var radio = row.querySelector('input[value="present"]');
      if (radio) { radio.checked = true; PageEnsAppel._onStatChange(i); }
    });
  },

  async soumettre() {
    if (!this._appelId) return toast('Appel non initialis\u00E9', 'w');

    var rows = document.querySelectorAll('#tb-appel-grille tr[id^="ar-"]');
    var presences = [];

    rows.forEach(function(row, i) {
      var inscriptionIdEl = row.querySelector('.ar-inscr');
      var inscriptionId = inscriptionIdEl ? inscriptionIdEl.value : null;
      var checkedRadio = row.querySelector('input[name="stat-' + i + '"]:checked');
      var stat = checkedRadio ? checkedRadio.value : 'present';
      var retardEl = row.querySelector('.ar-retard');
      var minutesRetard = retardEl ? parseInt(retardEl.value) : NaN;

      if (inscriptionId) {
        var p = { inscription_id: inscriptionId, statut: stat };
        if (stat === 'retard' && !isNaN(minutesRetard) && minutesRetard > 0) p.minutes_retard = minutesRetard;
        presences.push(p);
      }
    });

    if (!presences.length) return toast('Aucune pr\u00E9sence \u00E0 enregistrer', 'w');

    var btn = document.getElementById('btn-appel-soumettre');
    if (btn) { btn.disabled = true; btn.textContent = 'Enregistrement\u2026'; }

    try {
      await Api.put('/appels/' + this._appelId + '/presences', {
        presences: presences,
        cloturer: true,
      });

      var nbAbsents = presences.filter(function(p) { return p.statut === 'absent' || p.statut === 'retard'; }).length;
      toast('Appel enregistr\u00E9 \u2713' + (nbAbsents ? ' \u2014 ' + nbAbsents + ' absence(s) signal\u00E9e(s), parents notifi\u00E9s \uD83D\uDCF1' : ''), 's');
      this.retourCreneaux();
      await this._chargerCreneaux();

    } catch (e) {
      toast(e.message || 'Erreur lors de la soumission', 'e');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Soumettre l\'appel'; }
    }
  },
};

PAGE_HOOKS['ens-appel'] = function() { PageEnsAppel.init(); };
