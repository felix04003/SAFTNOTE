import { Api } from '../api';
import { escapeHtml, cn, toast, openModal, closeModal, exporterCsv } from '../ui';
import { PAGE_HOOKS } from '../router';

export const PageBulletins: any = {
  data: [],
  _bulletinCourant: null,  // détail affiché dans le modal
  _periodes: [] as any[],  // périodes de l'année courante (sélecteur)
  _periodeId: '',          // période affichée
  _occupe: false,          // génération en cours (évite le double clic)

  // Période par défaut : celle qui contient aujourd'hui, sinon la dernière commencée, sinon la première
  _periodeParDefaut(periodes: any[]): string {
    if (!periodes.length) return '';
    const jour = new Date().toISOString().slice(0, 10);
    const dedans = periodes.find(function(p: any) { return String(p.date_debut).slice(0, 10) <= jour && jour <= String(p.date_fin).slice(0, 10); });
    if (dedans) return dedans.id;
    const commencees = periodes.filter(function(p: any) { return String(p.date_debut).slice(0, 10) <= jour; });
    return (commencees.length ? commencees[commencees.length - 1] : periodes[0]).id;
  },

  async _chargerPeriodes() {
    if (this._periodes.length) return;
    try {
      const r = await Api.get('/annees-scolaires/courante');
      this._periodes = (r.data && r.data.periodes) || [];
    } catch (e: any) { this._periodes = []; }
    this._periodeId = this._periodeId || this._periodeParDefaut(this._periodes);
    const sel = document.getElementById('bull-periode') as HTMLSelectElement | null;
    if (sel) {
      sel.innerHTML = this._periodes.map(function(p: any) {
        return '<option value="' + escapeHtml(p.id) + '">' + escapeHtml(p.libelle || ('Période ' + p.numero)) + '</option>';
      }).join('');
      sel.value = this._periodeId;
    }
  },

  exporter() {
    if (!this._periodeId) return toast('Choisissez une période', 'w');
    return exporterCsv('/exports/moyennes.csv', { periode_id: this._periodeId });
  },

  async changerPeriode(id: string) {
    this._periodeId = id;
    await this.charger();
  },

  async charger() {
    try {
      await this._chargerPeriodes();
      const res = await Api.get('/bulletins/classes', this._periodeId ? { periode_id: this._periodeId } : undefined);
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
      // Les COUNT(*) de PostgreSQL arrivent en texte (« 0 ») : sans conversion, `valides === 0` n'était jamais
      // vrai et le bouton « Valider » d'une classe n'apparaissait jamais
      const effectif = parseInt(b.effectif || 0, 10);
      const generes = parseInt(b.generes || 0, 10);
      const valides = parseInt(b.valides || 0, 10);
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
          (effectif > 0 && generes < effectif ? '<button class="btn btn-o btn-sm" onclick="PageBulletins.genererClasse(\'' + b.id + '\')">⚡ Générer</button>' : '') +
          (valides === 0 && generes > 0 ? '<button class="btn btn-p btn-sm" onclick="PageBulletins.validerClasse(\'' + b.id + '\')">Valider</button>' : '') +
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
      const res = await Api.get('/bulletins', { classe_id: classeId, periode_id: this._periodeId });
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
              (b.valide_at ? ' <button class="btn btn-l btn-sm" title="' + (b.bulletin_disponible ? 'Télécharger le PDF' : 'PDF en cours de préparation') + '" onclick="PageBulletins.telecharger(\'' + b.id + '\')">📥 PDF</button>' : '') +
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

      if (!corps) return;
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
      const res = await Api.get('/bulletins', { classe_id: classeId, periode_id: this._periodeId });
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

  // ── Calculer les moyennes puis générer les bulletins d'une classe ─
  // Renvoie un compte rendu au lieu de lever : « Générer tous » continue avec les classes suivantes.
  async _genererPour(classeId: string): Promise<{ ok: boolean; nb?: number; message?: string }> {
    try {
      await Api.post('/moyennes/calculer', { classe_id: classeId, periode_id: this._periodeId });
      const res = await Api.post('/bulletins/generer', { classe_id: classeId, periode_id: this._periodeId });
      return { ok: true, nb: res.data && res.data.nb_bulletins };
    } catch (e: any) {
      return { ok: false, message: e.message || 'Erreur' };
    }
  },

  async genererClasse(classeId: string) {
    if (this._occupe) return;
    if (!this._periodeId) return toast('Aucune période scolaire', 'w');
    this._occupe = true;
    try {
      toast('Calcul des moyennes et génération en cours…', 's');
      const r = await this._genererPour(classeId);
      if (r.ok) toast((r.nb || 0) + ' bulletin(s) généré(s) ✓ (PDF en préparation)', 's');
      else toast(r.message || 'Génération impossible', 'e');
      await this.charger();
    } finally { this._occupe = false; }
  },

  async genererTous() {
    if (this._occupe) return;
    if (!this._periodeId) return toast('Aucune période scolaire', 'w');
    const classes = (this.data || []).filter(function(c: any) { return parseInt(c.effectif || 0) > 0 && parseInt(c.generes || 0) < parseInt(c.effectif || 0); });
    if (!classes.length) return toast('Tous les bulletins sont déjà générés', 'w');
    if (!confirm('Calculer les moyennes et générer les bulletins de ' + classes.length + ' classe(s) ?')) return;

    this._occupe = true;
    try {
      let nb = 0; const echecs: string[] = [];
      for (let i = 0; i < classes.length; i++) {
        const r = await this._genererPour(classes[i].id);
        if (r.ok) nb += r.nb || 0;
        else echecs.push((classes[i].classe || '?') + ' : ' + r.message);
      }
      if (nb) toast(nb + ' bulletin(s) généré(s) ✓', 's');
      // Une classe sans note publiée n'a pas de moyenne : on le dit au lieu de l'ignorer
      if (echecs.length) toast(echecs.length + ' classe(s) non générée(s) — ' + echecs[0], 'w');
      await this.charger();
    } finally { this._occupe = false; }
  },

  // ── Télécharger le PDF d'un bulletin validé (URL signée, 1 h) ────
  async telecharger(bulletinId: string) {
    try {
      const res = await Api.get('/bulletins/' + bulletinId + '/download');
      const url = res.data && res.data.download_url;
      if (!url) return toast('PDF indisponible', 'w');
      window.open(url, '_blank', 'noopener');
    } catch (e: any) {
      toast(e.message || 'PDF indisponible', 'e');
    }
  },

  init: function() {
    this.charger();
  }
};

(window as any).PageBulletins = PageBulletins;
PAGE_HOOKS['bulletins'] = () => PageBulletins.init();
