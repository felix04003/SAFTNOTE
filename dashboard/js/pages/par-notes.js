'use strict';

var PageParNotes = {
  _periodes:   [],
  _filtrePerid: '',

  init: async function() {
    var enfant = ParApp.enfantLien();
    if (enfant.peut_voir_notes === false) {
      PageParNotes._accesRefuse();
      return;
    }
    await PageParNotes._chargerPeriodes();
    await PageParNotes.charger();
  },

  _chargerPeriodes: async function() {
    try {
      var r = await Api.get('/annees-scolaires/courante');
      PageParNotes._periodes = (r.data && r.data.periodes) || [];
      var sel = document.getElementById('par-fil-periode');
      if (sel) {
        sel.innerHTML = '<option value="">Toutes les p\u00E9riodes</option>' +
          PageParNotes._periodes.map(function(p) {
            return '<option value="' + escapeHtml(String(p.id || '')) + '">' + escapeHtml(p.libelle || '') + '</option>';
          }).join('');
        if (PageParNotes._filtrePerid) sel.value = PageParNotes._filtrePerid;
      }
    } catch (e) { PageParNotes._periodes = []; }
  },

  filtrerPeriode: function(periodeId) {
    PageParNotes._filtrePerid = periodeId;
    PageParNotes.charger();
  },

  charger: async function() {
    var id = ParApp.enfantId();
    if (!id) return;
    var container = document.getElementById('par-notes-container');
    if (!container) return;
    container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--g400)">Chargement…</div>';

    try {
      var params = {};
      if (PageParNotes._filtrePerid) params.periode_id = PageParNotes._filtrePerid;

      var res  = await Api.get('/parents/moi/enfants/' + id + '/notes', params);
      var data = res.data || {};
      var parMatiere = data.par_matiere || [];

      var enfant = ParApp.enfantLien();
      var sous = document.getElementById('par-notes-sous');
      if (sous) sous.textContent = (enfant.classe || '') + ' · ' + (data.nb_notes || 0) + ' note(s)';

      if (!parMatiere.length) {
        container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--g400)">Aucune note publiée</div>';
        return;
      }

      container.innerHTML = parMatiere.map(function(m) {
        // Valider couleur CSS pour éviter l'injection de style
        var couleur = /^(#[0-9a-fA-F]{3,8}|rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)|var\(--[\w-]+\))$/.test(m.couleur) ? m.couleur : '#1a4731';
        var matiere = escapeHtml(m.matiere || '—');
        return '<div class="carte" style="margin-bottom:16px">' +
          '<div class="ch" style="border-left:3px solid ' + couleur + '">' +
            '<span style="color:' + couleur + ';font-weight:800">' + matiere + '</span>' +
          '</div>' +
          '<div class="tw">' +
            '<table>' +
              '<thead><tr>' +
                '<th>Type</th><th>Date</th><th>Note</th><th>Moy. classe</th><th>Appr\u00E9ciation</th>' +
              '</tr></thead>' +
              '<tbody>' +
                m.notes.map(function(n) {
                  var valAff = n.est_absent ? '<span class="badge bd">Absent</span>' :
                    (n.valeur != null ? '<span style="font-weight:800;color:' + _parCn(n.valeur) + '">' + n.valeur + '/' + (n.note_max || 20) + '</span>' : '\u2014');
                  return '<tr>' +
                    '<td><span class="badge bo">' + escapeHtml(n.type || '\u2014') + '</span></td>' +
                    '<td style="font-family:\'Space Mono\',monospace;font-size:11.5px">' + escapeHtml(n.date_evaluation || '\u2014') + '</td>' +
                    '<td>' + valAff + '</td>' +
                    '<td style="color:var(--g500);font-size:12px">' + (n.moyenne_classe != null ? n.moyenne_classe + '/20' : '\u2014') + '</td>' +
                    '<td style="color:var(--g500);font-size:12px">' + escapeHtml(n.appreciation || '') + '</td>' +
                  '</tr>';
                }).join('') +
              '</tbody>' +
            '</table>' +
          '</div>' +
        '</div>';
      }).join('');

    } catch (e) {
      if (container) container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--rouge)">' + escapeHtml(e.message || 'Erreur de chargement') + '</div>';
    }
  },

  _accesRefuse: function() {
    var container = document.getElementById('par-notes-container');
    if (container) container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--g400)">Accès aux notes non autorisé pour cet enfant.</div>';
  },

};

PAR_HOOKS['par-notes'] = function() { PageParNotes.init(); };
