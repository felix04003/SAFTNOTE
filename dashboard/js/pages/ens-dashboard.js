'use strict';

var PageEnsDashboard = {
  _classes: [],
  _creneaux: [],

  async init() {
    var user = Auth.getUser();
    var greet = document.getElementById('ens-greeting');
    if (greet) greet.textContent = 'Bonjour, ' + (user && user.prenom ? user.prenom : 'Enseignant') + ' 👋';

    await Promise.all([
      this._chargerKPI(),
      this._chargerAppelsJour(),
      this._chargerNotesAttente(),
    ]);
  },

  async _chargerKPI() {
    try {
      var res = await Api.get('/enseignants/moi/classes');
      this._classes = res.data || [];
      var nbClasses = this._classes.length;
      var nbEleves = this._classes.reduce(function(sum, c) { return sum + (c.effectif || 0); }, 0);
      _ensSet('ens-kpi-classes', nbClasses);
      _ensSet('ens-kpi-eleves', nbEleves);
      var anneeEl = document.getElementById('tb-annee');
      if (anneeEl && res.meta && res.meta.annee) anneeEl.textContent = '📅 ' + res.meta.annee;
    } catch (e) {
      _ensSet('ens-kpi-classes', '—');
      _ensSet('ens-kpi-eleves', '—');
    }
    try {
      var r2 = await Api.get('/evaluations', { statut: 'non_saisie' });
      _ensSet('ens-kpi-saisir', (r2.data || []).length);
    } catch (e) {
      _ensSet('ens-kpi-saisir', '—');
    }
  },

  async _chargerAppelsJour() {
    var el = document.getElementById('ens-appels-jour');
    if (!el) return;
    el.innerHTML = '<div style="padding:16px;text-align:center;color:var(--g400);font-size:13px">Chargement…</div>';
    try {
      var res = await Api.get('/enseignants/moi/edt');
      var edt = (res.data && res.data.emploi_du_temps) || [];
      // JS getDay(): 0=Dim, 1=Lun, ..., 6=Sam — Backend jour: 1=Lun, ..., 6=Sam
      // Values match directly for Mon-Sat; Sunday (0) returns no match (correct — no classes)
      var jourJS = new Date().getDay();
      var jourAuj = edt.find(function(j) { return j.jour === jourJS; });
      var creneaux = (jourAuj && jourAuj.creneaux) || [];
      creneaux = creneaux.filter(function(c) { return !c.est_pause; });

      if (!creneaux.length) {
        el.innerHTML = '<div style="text-align:center;padding:20px;color:var(--g400);font-size:13px">Aucun cours aujourd\'hui 🎉</div>';
        return;
      }
      PageEnsDashboard._creneaux = creneaux;
      el.innerHTML = creneaux.map(function(c) {
        var creneauId = escapeHtml(String(c.creneau_id || ''));
        return '<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--g100)">' +
          '<div>' +
            '<div style="font-weight:600;font-size:13px">' + escapeHtml(c.matiere || '\u2014') + ' \xb7 <span style="color:var(--g500)">' + escapeHtml(c.classe || '') + '</span></div>' +
            '<div style="font-size:11.5px;color:var(--g400);margin-top:2px">' + escapeHtml((c.heure_debut || '') + ' \u2013 ' + (c.heure_fin || '')) + (c.salle ? ' \xb7 ' + escapeHtml(c.salle) : '') + '</div>' +
          '</div>' +
          '<button class="btn btn-p btn-sm" onclick="PageEnsDashboard._lancerAppel(\'' + creneauId + '\')">Faire l\'appel</button>' +
        '</div>';
      }).join('');
    } catch (e) {
      el.innerHTML = '<div style="text-align:center;padding:20px;color:var(--g400);font-size:13px">Impossible de charger les créneaux</div>';
    }
  },

  async _chargerNotesAttente() {
    var el = document.getElementById('ens-notes-attente');
    if (!el) return;
    el.innerHTML = '<div style="padding:16px;text-align:center;color:var(--g400);font-size:13px">Chargement…</div>';
    try {
      var res = await Api.get('/evaluations', { statut: 'non_saisie' });
      var evals = (res.data || []).slice(0, 5);
      if (!evals.length) {
        el.innerHTML = '<div style="text-align:center;padding:20px;color:var(--g400);font-size:13px">Aucune note en attente ✓</div>';
        return;
      }
      el.innerHTML = evals.map(function(ev) {
        var evalId = escapeHtml(String(ev.id || ''));
        return '<div style="display:flex;align-items:center;justify-content:space-between;padding:9px 0;border-bottom:1px solid var(--g100)">' +
          '<div>' +
            '<div style="font-weight:600;font-size:13px">' + escapeHtml(ev.matiere || '\u2014') + '</div>' +
            '<div style="font-size:11.5px;color:var(--g400)">' + escapeHtml(ev.classe || '') + ' \xb7 ' + escapeHtml(ev.type || '') + ' \xb7 ' + escapeHtml(ev.date_evaluation || '\u2014') + '</div>' +
          '</div>' +
          '<button class="btn btn-l btn-sm" onclick="PageEnsNotes.ouvrirSaisie(\'' + evalId + '\');goto(\'ens-notes\')">' + 'Saisir \u2192</button>' +
        '</div>';
      }).join('');
    } catch (e) {
      el.innerHTML = '<div style="text-align:center;padding:20px;color:var(--g400);font-size:13px">Indisponible</div>';
    }
  },

  _lancerAppel: function(creneauId) {
    var c = (PageEnsDashboard._creneaux || []).find(function(x) { return String(x.creneau_id) === String(creneauId); });
    if (c) PageEnsAppel.lancerDepuisCreneau(c.creneau_id, c.matiere, c.classe, c.classe_id);
  },
};

function _ensSet(id, val) {
  var el = document.getElementById(id);
  if (el) el.textContent = (val != null) ? val : '—';
}

PAGE_HOOKS['ens-dashboard'] = function() { PageEnsDashboard.init(); };
