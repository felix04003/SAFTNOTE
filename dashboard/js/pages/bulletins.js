'use strict';

/**
 * Page Bulletins — charge depuis l'API,
 * fallback sur mock si backend indisponible.
 */
var PageBulletins = {
  data: [],
  _bulletinCourant: null,  // détail affiché dans le modal

  async charger() {
    try {
      var res = await Api.get('/bulletins/classes');
      this.data = res.data;
      this.renderTable(res.data);
      this.updateKpis(res.data);
      return true;
    } catch (e) {
      console.warn('PageBulletins: fallback mock —', e.message);
      return false;
    }
  },

  updateKpis: function(classes) {
    function set(id, val) { var el = document.getElementById(id); if (el) el.textContent = val; }
    var totalEleves = classes.reduce(function(s, c) { return s + parseInt(c.effectif || 0); }, 0);
    var totalGeneres = classes.reduce(function(s, c) { return s + parseInt(c.generes || 0); }, 0);
    var totalValides = classes.reduce(function(s, c) { return s + parseInt(c.valides || 0); }, 0);
    set('bull-kpi-generes',  totalGeneres);
    set('bull-kpi-attente',  totalEleves - totalGeneres);
    set('bull-kpi-valides',  totalValides);
    set('bull-kpi-telecharg', '—');
    // Sous-titre page bulletins
    var sousTitre = document.getElementById('ph-sous-bulletins');
    if (sousTitre && totalEleves) sousTitre.textContent = totalEleves + ' \u00E9l\u00E8ves \u00B7 ' + classes.length + ' classe' + (classes.length > 1 ? 's' : '');
  },

  renderTable: function(bulletins) {
    var tbody = document.getElementById('tb-bull');
    if (!tbody) return;

    if (!bulletins.length) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--g400);padding:30px">Aucun bulletin trouv\u00E9</td></tr>';
      return;
    }

    tbody.innerHTML = bulletins.map(function(b) {
      var moy = b.moyenne_classe != null ? b.moyenne_classe : null;
      var effectif = b.effectif || 0;
      var generes = b.generes || 0;
      var valides = b.valides || 0;
      var taux = b.taux_reussite || '\u2014';

      return '<tr>' +
        '<td class="nc">' + escapeHtml(b.classe || '\u2014') + '</td>' +
        '<td style="font-weight:600">' + effectif + '</td>' +
        '<td><div style="display:flex;align-items:center;gap:7px"><div class="pb" style="width:70px;height:7px"><div class="pf" style="width:' + (effectif ? generes / effectif * 100 : 0) + '%;--c:var(--success)"></div></div><span style="font-weight:600;font-size:11.5px">' + generes + '/' + effectif + '</span></div></td>' +
        '<td><span style="font-weight:600;color:' + (valides === effectif && effectif > 0 ? 'var(--success)' : 'var(--g500)') + '">' + valides + '</span></td>' +
        '<td>' + (moy != null ? '<span style="font-weight:700;color:' + cn(moy) + '">' + moy + '</span>' : '\u2014') + '</td>' +
        '<td style="font-size:12px">' + escapeHtml(b.premier_classe || '\u2014') + '</td>' +
        '<td><span class="badge ' + (parseFloat(taux) >= 80 ? 'bs' : parseFloat(taux) >= 70 ? 'bw' : 'bd') + '">' + taux + '</span></td>' +
        '<td style="display:flex;gap:5px">' +
          '<button class="btn btn-l btn-sm" onclick="PageBulletins.voirClasse(\'' + b.id + '\',\'' + (b.classe || '') + '\')">Voir</button>' +
          (valides === 0 && generes > 0 ? '<button class="btn btn-p btn-sm" onclick="PageBulletins.validerClasse(\'' + b.id + '\')">Valider</button>' : '') +
          '<button class="btn btn-l btn-sm">📥</button>' +
        '</td>' +
      '</tr>';
    }).join('');
  },

  // ── Voir les bulletins d'une classe ──────────────────────────────
  async voirClasse(classeId, nomClasse) {
    var titreEl = document.getElementById('bull-modal-titre');
    if (titreEl) titreEl.textContent = 'Bulletins — ' + (nomClasse || 'Classe');

    var corps = document.getElementById('bull-modal-corps');
    if (corps) corps.innerHTML = '<p style="text-align:center;padding:30px;color:var(--g400)">Chargement\u2026</p>';

    openModal('m-detail-bulletin');

    try {
      var res = await Api.get('/bulletins', { classe_id: classeId });
      var items = res.data || [];
      if (!items.length) {
        corps.innerHTML = '<p style="text-align:center;padding:30px;color:var(--g400)">Aucun bulletin g\u00E9n\u00E9r\u00E9 pour cette classe.</p>';
        return;
      }
      corps.innerHTML = '<div class="tw"><table>' +
        '<thead><tr><th>Élève</th><th>Matricule</th><th>Période</th><th>Moy. générale</th><th>Rang</th><th>Mention</th><th>Validé</th><th></th></tr></thead>' +
        '<tbody>' +
        items.map(function(b) {
          return '<tr>' +
            '<td style="font-weight:600">' + escapeHtml((b.prenom || '') + ' ' + (b.nom || '')) + '</td>' +
            '<td style="font-family:\'Space Mono\',monospace;font-size:11px;color:var(--g400)">' + escapeHtml(b.matricule || '—') + '</td>' +
            '<td>' + escapeHtml(b.periode || ('T' + (b.trimestre || '—'))) + '</td>' +
            '<td>' + (b.moyenne_generale != null ? '<span style="font-weight:700;color:' + cn(b.moyenne_generale) + '">' + b.moyenne_generale + '/20</span>' : '—') + '</td>' +
            '<td style="text-align:center">' + (b.rang != null ? b.rang + '/' + b.rang_sur : '—') + '</td>' +
            '<td>' + (b.mention ? '<span class="badge bs">' + escapeHtml(b.mention) + '</span>' : '—') + '</td>' +
            '<td style="text-align:center">' + (b.valide_at ? '<span style="color:var(--success)">✓</span>' : '<span style="color:var(--g300)">—</span>') + '</td>' +
            '<td><button class="btn btn-l btn-sm" onclick="PageBulletins.voirBulletin(\'' + b.id + '\')">Détail</button>' +
              (!b.valide_at ? ' <button class="btn btn-p btn-sm" onclick="PageBulletins.validerBulletin(\'' + b.id + '\')">Valider</button>' : '') +
            '</td>' +
          '</tr>';
        }).join('') +
        '</tbody></table></div>';
    } catch (e) {
      if (corps) corps.innerHTML = '<p style="text-align:center;padding:30px;color:var(--rouge)">Erreur : ' + escapeHtml(e.message || 'impossible de charger') + '</p>';
    }
  },

  // ── Voir un bulletin individuel ──────────────────────────────────
  async voirBulletin(bulletinId) {
    var corps = document.getElementById('bull-modal-corps');
    if (corps) corps.innerHTML = '<p style="text-align:center;padding:30px;color:var(--g400)">Chargement du bulletin\u2026</p>';

    try {
      var res = await Api.get('/bulletins/' + bulletinId);
      var b = res.data;
      var el = b.eleve || {};
      var per = b.periode || {};
      var res2 = b.resultat || {};
      var matieres = b.matieres || [];

      var titreEl = document.getElementById('bull-modal-titre');
      if (titreEl) titreEl.textContent = (el.prenom || '') + ' ' + (el.nom || '') + ' — ' + (per.libelle || '');

      corps.innerHTML =
        '<div style="padding:14px 18px;border-bottom:1px solid var(--g100);display:flex;gap:18px;flex-wrap:wrap">' +
          '<div><span style="font-size:11px;color:var(--g400)">Classe</span><div style="font-weight:600">' + escapeHtml(el.classe || '—') + '</div></div>' +
          '<div><span style="font-size:11px;color:var(--g400)">Matricule</span><div style="font-weight:600;font-family:\'Space Mono\',monospace;font-size:12px">' + escapeHtml(el.matricule || '—') + '</div></div>' +
          '<div><span style="font-size:11px;color:var(--g400)">Année</span><div style="font-weight:600">' + escapeHtml(per.annee_scolaire || '—') + '</div></div>' +
          '<div><span style="font-size:11px;color:var(--g400)">Moyenne générale</span><div style="font-size:20px;font-weight:800;color:' + cn(res2.moyenne_generale) + '">' + (res2.moyenne_generale != null ? res2.moyenne_generale + '/20' : '—') + '</div></div>' +
          '<div><span style="font-size:11px;color:var(--g400)">Rang</span><div style="font-weight:600">' + (res2.rang != null ? res2.rang + '/' + res2.rang_sur : '—') + '</div></div>' +
          '<div><span style="font-size:11px;color:var(--g400)">Mention</span><div style="font-weight:600">' + escapeHtml(res2.mention || '—') + '</div></div>' +
        '</div>' +
        '<div class="tw" style="max-height:45vh;overflow-y:auto"><table>' +
          '<thead><tr><th>Matière</th><th>Coeff.</th><th>Moyenne</th><th>Points</th><th>Rang</th><th>Appréciation</th></tr></thead>' +
          '<tbody>' +
          matieres.map(function(m) {
            return '<tr>' +
              '<td style="font-weight:600">' + escapeHtml(m.matiere || '—') + '</td>' +
              '<td style="text-align:center;color:var(--g400)">' + (m.coefficient || '—') + '</td>' +
              '<td>' + (m.moyenne != null ? '<span style="font-weight:700;color:' + cn(m.moyenne) + '">' + m.moyenne + '/20</span>' : '<span style="color:var(--g300)">—</span>') + '</td>' +
              '<td style="color:var(--g500)">' + (m.points != null ? m.points : '—') + '</td>' +
              '<td style="text-align:center">' + (m.rang_dans_classe != null ? m.rang_dans_classe + '/' + m.rang_sur : '—') + '</td>' +
              '<td style="font-size:12px;color:var(--g500)">' + escapeHtml(m.appreciation_enseignant || '—') + '</td>' +
            '</tr>';
          }).join('') +
          '</tbody></table></div>';
    } catch (e) {
      if (corps) corps.innerHTML = '<p style="text-align:center;padding:30px;color:var(--rouge)">Erreur : ' + escapeHtml(e.message || 'impossible de charger le bulletin') + '</p>';
    }
  },

  // ── Valider un bulletin individuel ───────────────────────────────
  async validerBulletin(bulletinId) {
    if (!confirm('Valider ce bulletin ? Cette action est irréversible.')) return;
    try {
      await Api.put('/bulletins/' + bulletinId + '/valider', {});
      toast('Bulletin validé ✓', 's');
      // Rafraîchir le contenu du modal
      var titreEl = document.getElementById('bull-modal-titre');
      var titre = titreEl ? titreEl.textContent : '';
      // Recharger la vue classe si possible
      await PageBulletins.charger();
    } catch (e) {
      toast(e.message || 'Erreur de validation', 'e');
    }
  },

  // ── Valider tous les bulletins générés d'une classe ──────────────
  async validerClasse(classeId) {
    if (!confirm('Valider tous les bulletins générés de cette classe ?')) return;
    try {
      var res = await Api.get('/bulletins', { classe_id: classeId });
      var items = (res.data || []).filter(function(b) { return !b.valide_at && b.bulletin_genere; });
      if (!items.length) return toast('Aucun bulletin à valider', 'w');

      var nb = 0;
      for (var i = 0; i < items.length; i++) {
        try {
          await Api.put('/bulletins/' + items[i].id + '/valider', {});
          nb++;
        } catch (e) { /* ignorer les erreurs individuelles */ }
      }
      toast(nb + ' bulletin(s) validé(s) ✓', 's');
      await this.charger();
    } catch (e) {
      toast(e.message || 'Erreur de validation', 'e');
    }
  },

  init: function() {
    this.charger();
  }
};

PAGE_HOOKS.bulletins = function() { PageBulletins.init(); };
