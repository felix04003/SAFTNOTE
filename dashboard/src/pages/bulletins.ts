import { Api } from '../api';
import { escapeHtml, cn, toast, openModal, closeModal } from '../ui';
import { PAGE_HOOKS } from '../router';

export const PageBulletins: any = {
  data: [],
  _bulletinCourant: null,  // détail affiché dans le modal

  async charger() {
    try {
      const res = await Api.get('/bulletins/classes');
      this.data = res.data;
      this.renderTable(res.data);
      this.updateKpis(res.data);
      return true;
    } catch (e: any) {
      console.error('PageBulletins.charger —', e.message);
      return false;
    }
  },

  updateKpis: function(classes: any[]) {
    function set(id: string, val: any) { const el = document.getElementById(id) as HTMLElement | null; if (el) el.textContent = val; }
    const totalEleves  = classes.reduce(function(s: number, c: any) { return s + parseInt(c.effectif || 0); }, 0);
    const totalGeneres = classes.reduce(function(s: number, c: any) { return s + parseInt(c.generes || 0); }, 0);
    const totalValides = classes.reduce(function(s: number, c: any) { return s + parseInt(c.valides || 0); }, 0);
    set('bull-kpi-generes',  totalGeneres);
    set('bull-kpi-attente',  totalEleves - totalGeneres);
    set('bull-kpi-valides',  totalValides);
    set('bull-kpi-telecharg', '—');
    // Sous-titre page bulletins
    const sousTitre = document.getElementById('ph-sous-bulletins') as HTMLElement | null;
    if (sousTitre && totalEleves) sousTitre.textContent = totalEleves + ' élèves · ' + classes.length + ' classe' + (classes.length > 1 ? 's' : '');
  },

  renderTable: function(bulletins: any[]) {
    const tbody = document.getElementById('tb-bull') as HTMLElement | null;
    if (!tbody) return;

    if (!bulletins.length) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--g400);padding:30px">Aucun bulletin trouvé</td></tr>';
      return;
    }

    tbody.innerHTML = bulletins.map(function(b: any) {
      const moy = b.moyenne_classe != null ? b.moyenne_classe : null;
      const effectif = b.effectif || 0;
      const generes = b.generes || 0;
      const valides = b.valides || 0;
      const taux = b.taux_reussite || '—';

      return '<tr>' +
        '<td class="nc">' + escapeHtml(b.classe || '—') + '</td>' +
        '<td style="font-weight:600">' + effectif + '</td>' +
        '<td><div style="display:flex;align-items:center;gap:7px"><div class="pb" style="width:70px;height:7px"><div class="pf" style="width:' + (effectif ? generes / effectif * 100 : 0) + '%;--c:var(--success)"></div></div><span style="font-weight:600;font-size:11.5px">' + generes + '/' + effectif + '</span></div></td>' +
        '<td><span style="font-weight:600;color:' + (valides === effectif && effectif > 0 ? 'var(--success)' : 'var(--g500)') + '">' + valides + '</span></td>' +
        '<td>' + (moy != null ? '<span style="font-weight:700;color:' + cn(moy) + '">' + moy + '</span>' : '—') + '</td>' +
        '<td style="font-size:12px">' + escapeHtml(b.premier_classe || '—') + '</td>' +
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
  async voirClasse(classeId: string, nomClasse: string) {
    const titreEl = document.getElementById('bull-modal-titre') as HTMLElement | null;
    if (titreEl) titreEl.textContent = 'Bulletins — ' + (nomClasse || 'Classe');

    const corps = document.getElementById('bull-modal-corps') as HTMLElement | null;
    if (corps) corps.innerHTML = '<p style="text-align:center;padding:30px;color:var(--g400)">Chargement…</p>';

    openModal('m-detail-bulletin');

    try {
      const res = await Api.get('/bulletins', { classe_id: classeId });
      const items = res.data || [];
      if (!items.length) {
        if (corps) corps.innerHTML = '<p style="text-align:center;padding:30px;color:var(--g400)">Aucun bulletin généré pour cette classe.</p>';
        return;
      }
      if (corps) corps.innerHTML = '<div class="tw"><table>' +
        '<thead><tr><th>Élève</th><th>Matricule</th><th>Période</th><th>Moy. générale</th><th>Rang</th><th>Mention</th><th>Validé</th><th></th></tr></thead>' +
        '<tbody>' +
        items.map(function(b: any) {
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
    } catch (e: any) {
      if (corps) corps.innerHTML = '<p style="text-align:center;padding:30px;color:var(--rouge)">Erreur : ' + escapeHtml(e.message || 'impossible de charger') + '</p>';
    }
  },

  // ── Voir un bulletin individuel ──────────────────────────────────
  async voirBulletin(bulletinId: string) {
    const corps = document.getElementById('bull-modal-corps') as HTMLElement | null;
    if (corps) corps.innerHTML = '<p style="text-align:center;padding:30px;color:var(--g400)">Chargement du bulletin…</p>';

    try {
      const res = await Api.get('/bulletins/' + bulletinId);
      const b = res.data;
      const el = b.eleve || {};
      const per = b.periode || {};
      const res2 = b.resultat || {};
      const matieres = b.matieres || [];

      const titreEl = document.getElementById('bull-modal-titre') as HTMLElement | null;
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
          matieres.map(function(m: any) {
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
    } catch (e: any) {
      if (corps) corps.innerHTML = '<p style="text-align:center;padding:30px;color:var(--rouge)">Erreur : ' + escapeHtml(e.message || 'impossible de charger le bulletin') + '</p>';
    }
  },

  // ── Valider un bulletin individuel ───────────────────────────────
  async validerBulletin(bulletinId: string) {
    if (!confirm('Valider ce bulletin ? Cette action est irréversible.')) return;
    try {
      await Api.put('/bulletins/' + bulletinId + '/valider', {});
      toast('Bulletin validé ✓', 's');
      await PageBulletins.charger();
    } catch (e: any) {
      toast(e.message || 'Erreur de validation', 'e');
    }
  },

  // ── Valider tous les bulletins générés d'une classe ──────────────
  async validerClasse(classeId: string) {
    if (!confirm('Valider tous les bulletins générés de cette classe ?')) return;
    try {
      const res = await Api.get('/bulletins', { classe_id: classeId });
      const items = (res.data || []).filter(function(b: any) { return !b.valide_at && b.bulletin_genere; });
      if (!items.length) return toast('Aucun bulletin à valider', 'w');

      let nb = 0;
      for (let i = 0; i < items.length; i++) {
        try {
          await Api.put('/bulletins/' + items[i].id + '/valider', {});
          nb++;
        } catch (e) { /* ignorer les erreurs individuelles */ }
      }
      toast(nb + ' bulletin(s) validé(s) ✓', 's');
      await this.charger();
    } catch (e: any) {
      toast(e.message || 'Erreur de validation', 'e');
    }
  },

  init: function() {
    this.charger();
  }
};

(window as any).PageBulletins = PageBulletins;
PAGE_HOOKS['bulletins'] = () => PageBulletins.init();
