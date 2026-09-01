'use strict';

var PageParBulletins = {
  _bulletinsData: null,

  init: async function() {
    var enfant = ParApp.enfantLien();
    if (enfant.peut_voir_bulletins === false) {
      PageParBulletins._accesRefuse();
      return;
    }
    await PageParBulletins.charger();
  },

  charger: async function() {
    var id = ParApp.enfantId();
    if (!id) return;
    var liste = document.getElementById('par-bulletins-liste');
    if (!liste) return;
    liste.innerHTML = '<div style="text-align:center;padding:40px;color:var(--g400)">Chargement…</div>';

    try {
      var res = await Api.get('/parents/moi/enfants/' + id + '/bulletins');
      PageParBulletins._bulletinsData = res.data || {};
      var bulletins = PageParBulletins._bulletinsData.bulletins || [];

      var sous = document.getElementById('par-bulletins-sous');
      if (sous) sous.textContent = (PageParBulletins._bulletinsData.annee || '') + (PageParBulletins._bulletinsData.enfant ? ' · ' + PageParBulletins._bulletinsData.enfant.classe : '');

      if (!bulletins.length) {
        liste.innerHTML = '<div style="text-align:center;padding:40px;color:var(--g400)">Aucun bulletin disponible pour cette année.</div>';
        return;
      }

      liste.innerHTML = bulletins.map(function(b, i) {
        return PageParBulletins._renderBulletin(b, i);
      }).join('');

    } catch (e) {
      liste.innerHTML = '<div style="text-align:center;padding:40px;color:var(--rouge)">' + escapeHtml(e.message || 'Erreur de chargement') + '</div>';
    }
  },

  _renderBulletin: function(b, i) {
    var mention = b.mention || '—';
    var couleurMention = { 'Excellent': 'var(--vert)', 'Très Bien': 'var(--vert)', 'Bien': 'var(--bleu)', 'Assez Bien': 'var(--orange)' }[mention] || 'var(--g500)';

    var matiereRows = (b.matieres || []).map(function(m) {
      var moy = m.moyenne != null ? m.moyenne : '—';
      return '<tr>' +
        '<td class="nc">' + escapeHtml(m.matiere || '—') + '</td>' +
        '<td style="text-align:center">' + (m.coefficient || 1) + '</td>' +
        '<td style="text-align:center;font-weight:700;color:' + _parCn(m.moyenne) + '">' + moy + '</td>' +
        '<td style="text-align:center;font-size:12px;color:var(--g500)">' + (m.rang_dans_classe ? m.rang_dans_classe + 'e' : '—') + '</td>' +
        '<td style="font-size:12px;color:var(--g500)">' + escapeHtml(m.appreciation_enseignant || '') + '</td>' +
      '</tr>';
    }).join('');

    var detailId = 'bul-detail-' + i;

    return '<div class="carte" style="margin-bottom:16px">' +
      '<div class="ch" style="cursor:pointer" onclick="document.getElementById(\'' + detailId + '\').style.display = document.getElementById(\'' + detailId + '\').style.display === \'none\' ? \'\' : \'none\'">' +
        '<span>📄</span>' +
        '<span class="ct">' + escapeHtml(b.periode || ('Trimestre ' + b.trimestre)) + '</span>' +
        '<span style="font-size:13px;font-weight:800;color:var(--vert)">' + (b.moyenne_generale != null ? b.moyenne_generale + '/20' : '') + '</span>' +
        '<span class="badge" style="background:var(--g100);color:' + couleurMention + ';border:1px solid ' + couleurMention + '">' + escapeHtml(mention) + '</span>' +
        (b.rang ? '<span style="font-size:12px;color:var(--g400)">' + b.rang + 'e / ' + b.rang_sur + '</span>' : '') +
        '<span style="margin-left:auto;font-size:12px;color:var(--g400)">▾</span>' +
      '</div>' +
      '<div id="' + detailId + '" style="display:' + (i === 0 ? '' : 'none') + '">' +
        '<div style="display:flex;gap:16px;padding:12px 18px;background:var(--g50);font-size:12px;color:var(--g500)">' +
          '<span>Absences justif. : <b>' + (b.nb_absences_justifiees || 0) + '</b></span>' +
          '<span>Injustif. : <b style="color:var(--orange)">' + (b.nb_absences_injustifiees || 0) + '</b></span>' +
          '<span>Retards : <b>' + (b.nb_retards || 0) + '</b></span>' +
        '</div>' +
        '<div class="tw"><table>' +
          '<thead><tr><th>Matière</th><th>Coef.</th><th>Moyenne</th><th>Rang</th><th>Appréciation</th></tr></thead>' +
          '<tbody>' + matiereRows + '</tbody>' +
        '</table></div>' +
        (b.appreciation_conseil
          ? '<div style="padding:12px 18px;border-top:1px solid var(--g100);font-size:13px;color:var(--g700)"><b>Conseil de classe :</b> ' + escapeHtml(b.appreciation_conseil) + (b.decision_conseil ? ' \u2014 <b>' + escapeHtml(b.decision_conseil) + '</b>' : '') + '</div>'
          : '') +
        (b.bulletin_url && /^https?:\/\//.test(b.bulletin_url)
          ? '<div style="padding:12px 18px;border-top:1px solid var(--g100)"><a href="' + escapeHtml(b.bulletin_url) + '" target="_blank" class="btn btn-l btn-sm">\uD83D\uDCE5 T\u00E9l\u00E9charger le bulletin PDF</a></div>'
          : '') +
      '</div>' +
    '</div>';
  },

  _accesRefuse: function() {
    var liste = document.getElementById('par-bulletins-liste');
    if (liste) liste.innerHTML = '<div style="text-align:center;padding:40px;color:var(--g400)">Accès aux bulletins non autorisé pour cet enfant.</div>';
  },

};

PAR_HOOKS['par-bulletins'] = function() { PageParBulletins.init(); };
