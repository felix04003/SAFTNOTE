'use strict';

var PageParAbsences = {

  init: async function() {
    var enfant = ParApp.enfantLien();
    if (enfant.peut_voir_absences === false) {
      PageParAbsences._accesRefuse();
      return;
    }
    await PageParAbsences.charger();
  },

  charger: async function() {
    var id = ParApp.enfantId();
    if (!id) return;
    var tbody = document.getElementById('tb-par-absences');
    if (tbody) tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:28px;color:var(--g400)">Chargement…</td></tr>';

    try {
      // Détail des absences
      var res = await Api.get('/parents/moi/enfants/' + id + '/absences');
      var absences = res.data || [];

      // Totaux depuis le tableau de bord (justifiées / injustifiées / retards)
      var tdbRes = await Api.get('/parents/moi/tableau-de-bord');
      var tdb = (tdbRes.data || []).find(function(e) { return e.enfant && e.enfant.id === id; });
      var abs = (tdb && tdb.absences) || {};
      PageParAbsences._renderRecap(abs);
      PageParAbsences._renderDetail(absences);

    } catch (e) {
      if (tbody) tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:28px;color:var(--rouge)">' + (e.message || 'Erreur') + '</td></tr>';
    }
  },

  _renderRecap: function(abs) {
    var el = document.getElementById('par-recap-abs-table');
    if (!el) return;
    var just   = abs.justifiees   || 0;
    var injust = abs.injustifiees || 0;
    var retard = abs.retards      || 0;
    el.innerHTML =
      '<div class="carte"><div class="ch"><span>📊</span><span class="ct">Récapitulatif total</span></div>' +
      '<div style="display:flex;gap:12px;padding:12px 16px">' +
        '<div style="flex:1;text-align:center"><div style="font-size:22px;font-weight:800;color:var(--orange)">' + injust + '</div><div style="font-size:11px;color:var(--g400)">Injustifiées</div></div>' +
        '<div style="flex:1;text-align:center"><div style="font-size:22px;font-weight:800;color:var(--g500)">'  + just  + '</div><div style="font-size:11px;color:var(--g400)">Justifiées</div></div>' +
        '<div style="flex:1;text-align:center"><div style="font-size:22px;font-weight:800;color:var(--bleu)">'  + retard + '</div><div style="font-size:11px;color:var(--g400)">Retards</div></div>' +
      '</div></div>';
  },

  _renderDetail: function(absences) {
    var tbody = document.getElementById('tb-par-absences');
    if (!tbody) return;

    if (!absences.length) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:28px;color:var(--g400)">Aucune absence enregistrée ✓</td></tr>';
      return;
    }

    var JOURS = ['', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];

    tbody.innerHTML = absences.map(function(a) {
      var jour   = JOURS[a.jour_semaine] || '';
      var statut = { absent: 'Absent', retard: 'Retard', sorti_avant: 'Sorti tôt' }[a.statut] || a.statut;
      var couleur = a.statut === 'absent' ? 'var(--rouge)' : a.statut === 'retard' ? 'var(--orange)' : 'var(--g500)';
      var justif  = a.est_justifie
        ? '<span class="badge bs">✓ Justifié' + (a.motif_justification ? ' — ' + a.motif_justification : '') + '</span>'
        : '<span class="badge bd">Non justifié</span>';

      return '<tr>' +
        '<td style="font-family:\'Space Mono\',monospace;font-size:11.5px">' + (a.date_cours || '—') + '</td>' +
        '<td class="nc">' + (a.matiere || '—') + '</td>' +
        '<td style="font-size:12px;color:var(--g500)">' + (jour ? jour + ' ' : '') + (a.heure_debut || '') + '–' + (a.heure_fin || '') + '</td>' +
        '<td><span style="font-weight:600;color:' + couleur + '">' + statut + (a.minutes_retard ? ' (' + a.minutes_retard + 'min)' : '') + '</span></td>' +
        '<td>' + justif + '</td>' +
      '</tr>';
    }).join('');
  },

  _accesRefuse: function() {
    var tbody = document.getElementById('tb-par-absences');
    if (tbody) tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:28px;color:var(--g400)">Accès aux absences non autorisé pour cet enfant.</td></tr>';
    var recap = document.getElementById('par-recap-abs-table');
    if (recap) recap.innerHTML = '';
  },

};

PAR_HOOKS['par-absences'] = function() { PageParAbsences.init(); };
