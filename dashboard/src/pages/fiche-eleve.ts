import { Api } from '../api';
import { escapeHtml, cn, init2, toast, openModal, closeModal } from '../ui';
import { PAGE_HOOKS, goto } from '../router';

const nombre = (v: any, decimales = 2): string => (v == null || v === '' || Number.isNaN(Number(v))) ? '—' : Number(v).toFixed(decimales).replace(/\.?0+$/, '');
const dateFr = (iso: any): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? m[3] + '/' + m[2] + '/' + m[1] : '—';
};

/** Moyennes par matière en tableau matière × période : [{ matiere, parPeriode: { 1: 14.5, 2: null } }] */
export function grillePeriodes(moyennesMatieres: any[]): { periodes: number[]; lignes: { matiere: string; coefficient: any; parPeriode: Record<number, any> }[] } {
  const periodes = [...new Set(moyennesMatieres.map((m) => Number(m.trimestre)))].sort((a, b) => a - b);
  const parMatiere = new Map<string, { matiere: string; coefficient: any; parPeriode: Record<number, any> }>();
  for (const m of moyennesMatieres) {
    if (!parMatiere.has(m.matiere)) parMatiere.set(m.matiere, { matiere: m.matiere, coefficient: m.coefficient, parPeriode: {} });
    parMatiere.get(m.matiere)!.parPeriode[Number(m.trimestre)] = m.moyenne;
  }
  return { periodes, lignes: [...parMatiere.values()].sort((a, b) => a.matiere.localeCompare(b.matiere, 'fr')) };
}

const GENRES: Record<string, string> = { M: 'Masculin', F: 'Féminin' };
const LIENS: Record<string, string> = { pere: 'Père', mere: 'Mère', tuteur: 'Tuteur', grand_parent: 'Grand-parent', oncle_tante: 'Oncle / tante', autre: 'Autre' };

const carte = (icone: string, titre: string, corps: string, action = '') =>
  '<div class="carte" style="margin-bottom:18px"><div class="ch"><span>' + icone + '</span><span class="ct">' + titre + '</span>' + action + '</div><div class="cb">' + corps + '</div></div>';
const vide = (texte: string) => '<div style="color:var(--g400);font-size:13px;padding:6px 0">' + escapeHtml(texte) + '</div>';
const indisponible = (e: any) => '<div style="color:var(--g500);font-size:13px;padding:6px 0">Indisponible : ' + escapeHtml((e && e.message) || 'erreur') + '</div>';
const champ = (label: string, valeur: string) =>
  '<div><div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--g400);margin-bottom:3px">' + label + '</div><div style="font-size:13px">' + valeur + '</div></div>';

export const PageFicheEleve: any = {
  _id: '',

  ouvrir(id: string) {
    this._id = id;
    goto('fiche-eleve');
  },

  retour() { goto('eleves'); },

  async charger() {
    const zone = document.getElementById('fiche-eleve-contenu') as HTMLElement | null;
    if (!zone) return;
    if (!this._id) { goto('eleves'); return; }
    zone.innerHTML = '<p style="text-align:center;padding:40px;color:var(--g400)">Chargement de la fiche…</p>';

    const id = encodeURIComponent(this._id);
    // Chaque section se charge seule : un droit manquant (discipline…) ou une panne n'empêche pas d'afficher le reste
    const [identite, moyennes, notes, resume, absences, discipline] = await Promise.allSettled([
      Api.get('/eleves/' + id), Api.get('/moyennes/eleve/' + id), Api.get('/eleves/' + id + '/notes'),
      Api.get('/eleves/' + id + '/tableau-de-bord'), Api.get('/eleves/' + id + '/absences'), Api.get('/discipline/eleves/' + id + '/dossier'),
    ]);

    if (identite.status === 'rejected') {
      zone.innerHTML = vide('Élève introuvable : ' + ((identite.reason && identite.reason.message) || ''));
      return;
    }
    const e = identite.value.data;
    const titre = document.getElementById('fiche-eleve-titre');
    if (titre) titre.textContent = (e.prenom || '') + ' ' + (e.nom || '');

    zone.innerHTML =
      this.rendreEntete(e) +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(360px,1fr));gap:0 18px">' +
        '<div>' + this.rendreIdentite(e) + this.rendreParents(e) + this.rendreMedical(e) + '</div>' +
        '<div>' + this.rendreResultats(moyennes) + this.rendreNotes(notes) + '</div>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(360px,1fr));gap:0 18px">' +
        '<div>' + this.rendreAbsences(resume, absences) + '</div>' +
        '<div>' + this.rendreDiscipline(discipline) + '</div>' +
      '</div>';
  },

  rendreEntete(e: any): string {
    const nom = (e.prenom || '') + ' ' + (e.nom || '');
    return '<div class="carte" style="margin-bottom:18px"><div class="cb" style="display:flex;align-items:center;gap:16px">' +
      '<div class="av" style="width:56px;height:56px;font-size:22px">' + escapeHtml(init2(nom)) + '</div>' +
      '<div style="flex:1"><div style="font-size:20px;font-weight:700">' + escapeHtml(nom) + '</div>' +
        '<div style="font-size:12px;color:var(--g400);font-family:\'Space Mono\',monospace">' + escapeHtml(e.matricule || '—') + '</div></div>' +
      (e.classe ? '<span class="badge bp" style="font-size:13px">' + escapeHtml(e.classe) + '</span>' : '<span class="badge bn">Non inscrit cette année</span>') +
    '</div></div>';
  },

  rendreIdentite(e: any): string {
    return carte('🎓', 'Identité',
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">' +
        champ('Date de naissance', escapeHtml(dateFr(e.date_naissance))) +
        champ('Sexe', escapeHtml(GENRES[e.genre] || '—')) +
        champ('Classe', escapeHtml(e.classe || '—') + (e.annee ? ' <span style="color:var(--g400)">(' + escapeHtml(e.annee) + ')</span>' : '')) +
        champ('Inscrit le', escapeHtml(dateFr(e.date_inscription))) +
        '<div style="grid-column:1/-1">' + champ('Adresse', escapeHtml(e.adresse || '—')) + '</div>' +
      '</div>');
  },

  _parents: [] as any[],
  _parentEdit: '',
  _parentInitial: null as any,

  rendreParents(e: any): string {
    const parents = e.parents || [];
    this._parents = parents;
    const ajouter = '<button class="btn btn-p btn-sm" style="margin-left:auto" onclick="PageFicheEleve.ajouterParent()">+ Ajouter</button>';
    return carte('👨‍👩‍👧', 'Parents et tuteurs', parents.length
      ? '<table style="width:100%;font-size:13px"><tbody>' + parents.map(function(p: any) {
          const id = escapeHtml(p.id);
          return '<tr><td style="padding:6px 0"><b>' + escapeHtml((p.prenom || '') + ' ' + (p.nom || '')) + '</b>' +
            (p.est_contact_principal ? ' <span class="badge bs">Contact principal</span>' : '') +
            '<br><span style="color:var(--g500)">' + escapeHtml(LIENS[p.lien] || p.lien || '') + '</span></td>' +
            '<td style="text-align:right;font-family:\'Space Mono\',monospace;font-size:12px">' + escapeHtml(p.telephone || '—') + '</td>' +
            '<td style="text-align:right;white-space:nowrap;padding-left:10px">' +
              '<button class="btn btn-l btn-sm" onclick="PageFicheEleve.modifierParent(\'' + id + '\')">Modifier</button> ' +
              '<button class="btn btn-l btn-sm" onclick="PageFicheEleve.retirerParent(\'' + id + '\')">Retirer</button></td></tr>';
        }).join('') + '</tbody></table>'
      : vide('Aucun parent enregistré : aucune notification ne pourra être envoyée.'), ajouter);
  },

  // ── Ajouter / corriger / retirer un parent (ids seuls dans les attributs : règle 21) ──
  _champ(id: string): HTMLInputElement | null { return document.getElementById(id) as HTMLInputElement | null; },
  _val(id: string): string { return (this._champ(id)?.value || '').trim(); },
  _coche(id: string): boolean { return Boolean(this._champ(id)?.checked); },
  _remplir(id: string, v: any) { const el = this._champ(id); if (el) el.value = v == null ? '' : String(v); },
  _cocher(id: string, v: boolean) { const el = this._champ(id); if (el) el.checked = v; },

  _modeParent(edition: boolean) {
    const titre = document.getElementById('fpar-titre'); if (titre) titre.textContent = edition ? 'Modifier le parent' : 'Ajouter un parent ou tuteur';
    const droits = document.getElementById('fpar-droits'); if (droits) droits.style.display = edition ? '' : 'none';
    const note = document.getElementById('fpar-note-compte'); if (note) note.style.display = edition ? '' : 'none';
  },

  ajouterParent() {
    this._parentEdit = ''; this._parentInitial = null;
    ['fpar-prenom', 'fpar-nom', 'fpar-tel'].forEach((id) => this._remplir(id, ''));
    this._remplir('fpar-lien', 'tuteur'); this._cocher('fpar-principal', !this._parents.length);
    this._modeParent(false);
    openModal('m-parent');
  },

  modifierParent(parentId: string) {
    const p = this._parents.find((x: any) => x.id === parentId);
    if (!p) return;
    this._parentEdit = parentId;
    this._parentInitial = p;
    this._remplir('fpar-prenom', p.prenom); this._remplir('fpar-nom', p.nom); this._remplir('fpar-tel', p.telephone);
    this._remplir('fpar-lien', p.lien); this._cocher('fpar-principal', Boolean(p.est_contact_principal));
    this._cocher('fpar-notes', p.peut_voir_notes !== false); this._cocher('fpar-absences', p.peut_voir_absences !== false);
    this._cocher('fpar-bulletins', p.peut_voir_bulletins !== false); this._cocher('fpar-discipline', p.peut_voir_discipline !== false);
    this._modeParent(true);
    openModal('m-parent');
  },

  async enregistrerParent() {
    const prenom = this._val('fpar-prenom'), nom = this._val('fpar-nom'), telephone = this._val('fpar-tel');
    if (prenom.length < 2 || nom.length < 2) return toast('Prénom et nom obligatoires', 'w');
    if (telephone.length < 6) return toast('Numéro de téléphone obligatoire', 'w');
    const lien = this._val('fpar-lien') || 'tuteur';
    const principal = this._coche('fpar-principal');
    const bouton = this._champ('fpar-enregistrer') as HTMLButtonElement | null;
    if (bouton) bouton.disabled = true;
    try {
      const eleve = encodeURIComponent(this._id);
      if (!this._parentEdit) {
        const res = await Api.post('/eleves/' + eleve + '/parents', { prenom, nom, telephone, lien, est_contact_principal: principal });
        const existant = res.data && res.data.compte_existant;
        toast(existant
          ? 'Ce numéro est déjà celui de ' + existant.prenom + ' ' + existant.nom + ' : rattaché(e) à l\'élève ✓'
          : 'Parent ajouté ✓', 's');
      } else {
        const avant = this._parentInitial || {};
        const corps: Record<string, any> = {};
        if (prenom !== avant.prenom) corps.prenom = prenom;
        if (nom !== avant.nom) corps.nom = nom;
        if (telephone !== avant.telephone) corps.telephone = telephone;
        if (lien !== avant.lien) corps.lien = lien;
        if (principal !== Boolean(avant.est_contact_principal)) corps.est_contact_principal = principal;
        const droits: [string, string][] = [['peut_voir_notes', 'fpar-notes'], ['peut_voir_absences', 'fpar-absences'], ['peut_voir_bulletins', 'fpar-bulletins'], ['peut_voir_discipline', 'fpar-discipline']];
        for (const [cle, id] of droits) if (this._coche(id) !== (avant[cle] !== false)) corps[cle] = this._coche(id);
        if (!Object.keys(corps).length) { closeModal('m-parent'); return; }
        await Api.put('/eleves/' + eleve + '/parents/' + encodeURIComponent(this._parentEdit), corps);
        toast('Parent modifié ✓', 's');
      }
      closeModal('m-parent');
      await this.charger();
    } catch (e: any) {
      toast(e.message || 'Enregistrement impossible', 'e');
    } finally {
      if (bouton) bouton.disabled = false;
    }
  },

  async retirerParent(parentId: string) {
    const p = this._parents.find((x: any) => x.id === parentId);
    const nom = p ? ((p.prenom || '') + ' ' + (p.nom || '')).trim() : 'ce parent';
    if (!confirm('Retirer ' + nom + ' de cet élève ?\nSon compte est conservé (ses autres enfants), mais il ne verra plus les informations de cet élève.')) return;
    try {
      await Api.del('/eleves/' + encodeURIComponent(this._id) + '/parents/' + encodeURIComponent(parentId));
      toast(nom + ' : retiré(e) de cet élève ✓', 's');
      await this.charger();
    } catch (e: any) {
      toast(e.message || 'Retrait impossible', 'e');
    }
  },

  rendreMedical(e: any): string {
    if (e.medical_masque) return carte('🩺', 'Santé', vide('Données médicales réservées à la direction.'));
    const lignes: [string, any][] = [['Allergies', e.allergies], ['Conditions médicales', e.conditions_medicales], ['Groupe sanguin', e.groupe_sanguin], ['Médecin / urgence', e.medecin_urgence]];
    const renseignees = lignes.filter(function(l) { return l[1]; });
    return carte('🩺', 'Santé', renseignees.length
      ? '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">' + renseignees.map(function(l) { return champ(l[0], escapeHtml(l[1])); }).join('') + '</div>'
      : vide('Aucune donnée médicale renseignée.'));
  },

  rendreResultats(res: PromiseSettledResult<any>): string {
    if (res.status === 'rejected') return carte('📊', 'Résultats', indisponible(res.reason));
    const d = res.value.data || {};
    const generales = d.moyennes_generales || [];
    const grille = grillePeriodes(d.moyennes_matieres || []);
    if (!generales.length && !grille.lignes.length) return carte('📊', 'Résultats', vide('Aucune moyenne calculée pour le moment.'));
    const generalesHtml = generales.length
      ? '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:14px">' + generales.map(function(g: any) {
          return '<div style="border:1px solid var(--g100);border-radius:10px;padding:10px 14px;min-width:120px">' +
            '<div style="font-size:11px;color:var(--g400)">' + escapeHtml(g.periode || ('Période ' + g.trimestre)) + '</div>' +
            '<div style="font-size:20px;font-weight:800;color:' + cn(Number(g.moyenne_generale)) + '">' + nombre(g.moyenne_generale) + '/20</div>' +
            '<div style="font-size:12px;color:var(--g500)">' + (g.rang != null ? 'Rang ' + g.rang + '/' + g.rang_sur : '—') + (g.mention ? ' · ' + escapeHtml(g.mention) : '') + '</div></div>';
        }).join('') + '</div>' : '';
    const tableau = grille.lignes.length
      ? '<div class="tw"><table><thead><tr><th>Matière</th><th>Coeff.</th>' + grille.periodes.map(function(p) { return '<th>T' + p + '</th>'; }).join('') + '</tr></thead><tbody>' +
          grille.lignes.map(function(l) {
            return '<tr><td class="nc">' + escapeHtml(l.matiere) + '</td><td style="color:var(--g400)">' + escapeHtml(l.coefficient ?? '—') + '</td>' +
              grille.periodes.map(function(p) {
                const v = l.parPeriode[p];
                return '<td>' + (v == null ? '<span style="color:var(--g300)">—</span>' : '<b style="color:' + cn(Number(v)) + '">' + nombre(v) + '</b>') + '</td>';
              }).join('') + '</tr>';
          }).join('') + '</tbody></table></div>' : '';
    return carte('📊', 'Résultats' + (d.classe ? ' · ' + escapeHtml(d.classe) : ''), generalesHtml + tableau);
  },

  rendreNotes(res: PromiseSettledResult<any>): string {
    if (res.status === 'rejected') return carte('📝', 'Dernières notes', indisponible(res.reason));
    const notes = (res.value.data || []).slice().sort(function(a: any, b: any) { return String(b.date_evaluation).localeCompare(String(a.date_evaluation)); }).slice(0, 10);
    return carte('📝', 'Dernières notes publiées', notes.length
      ? '<div class="tw"><table><thead><tr><th>Date</th><th>Matière</th><th>Type</th><th>Note</th></tr></thead><tbody>' + notes.map(function(n: any) {
          return '<tr><td>' + escapeHtml(dateFr(n.date_evaluation)) + '</td><td class="nc">' + escapeHtml(n.matiere) + '</td><td>' + escapeHtml(n.type || '—') + '</td>' +
            '<td>' + (n.est_absent ? '<span class="badge bw">Absent</span>' : n.valeur == null ? '—' : '<b style="color:' + cn(Number(n.valeur)) + '">' + nombre(n.valeur) + '/20</b>') + '</td></tr>';
        }).join('') + '</tbody></table></div>'
      : vide('Aucune note publiée.'));
  },

  rendreAbsences(resume: PromiseSettledResult<any>, liste: PromiseSettledResult<any>): string {
    let totaux = '';
    if (resume.status === 'fulfilled') {
      const a = (resume.value.data || {}).absences || {};
      const n = (v: any) => String(parseInt(v || 0, 10));
      totaux = '<div style="display:flex;gap:12px;margin-bottom:12px">' +
        '<div><b>' + n(a.injustifiees) + '</b> <span style="color:var(--g500);font-size:12px">non justifiée(s)</span></div>' +
        '<div><b>' + n(a.justifiees) + '</b> <span style="color:var(--g500);font-size:12px">justifiée(s)</span></div>' +
        '<div><b>' + n(a.retards) + '</b> <span style="color:var(--g500);font-size:12px">retard(s)</span></div></div>';
    }
    if (liste.status === 'rejected') return carte('📅', 'Absences', totaux + indisponible(liste.reason));
    const lignes = (liste.value.data || []).slice(0, 10);
    return carte('📅', 'Absences', totaux + (lignes.length
      ? '<div class="tw"><table><thead><tr><th>Date</th><th>Matière</th><th>Justifiée</th></tr></thead><tbody>' + lignes.map(function(a: any) {
          return '<tr><td>' + escapeHtml(dateFr(a.date_cours)) + '</td><td class="nc">' + escapeHtml(a.matiere) + '</td>' +
            '<td>' + (a.est_justifie ? '<span class="badge bs">Oui</span>' + (a.justification ? ' <span style="font-size:12px;color:var(--g500)">' + escapeHtml(a.justification) + '</span>' : '') : '<span class="badge bd">Non</span>') + '</td></tr>';
        }).join('') + '</tbody></table></div>'
      : vide('Aucune absence enregistrée.')));
  },

  rendreDiscipline(res: PromiseSettledResult<any>): string {
    // Sans la permission « discipline.voir », la section est simplement absente
    if (res.status === 'rejected') {
      const code = res.reason && res.reason.status;
      return code === 403 ? '' : carte('⚠️', 'Discipline', indisponible(res.reason));
    }
    const d = res.value.data || {};
    const incidents = d.incidents || [];
    const sanctions = d.sanctions || [];
    if (!incidents.length && !sanctions.length) return carte('⚠️', 'Discipline', vide('Aucun incident ni sanction.'));
    return carte('⚠️', 'Discipline',
      (sanctions.length ? '<div style="font-weight:600;margin-bottom:6px">Sanctions</div><table style="width:100%;font-size:13px;margin-bottom:12px"><tbody>' + sanctions.map(function(s: any) {
        return '<tr><td style="padding:4px 0">' + escapeHtml(dateFr(s.date_prononcee)) + '</td><td><b>' + escapeHtml(String(s.type || '').replace(/_/g, ' ')) + '</b>' +
          (s.motif ? '<br><span style="color:var(--g500)">' + escapeHtml(s.motif) + '</span>' : '') + '</td></tr>';
      }).join('') + '</tbody></table>' : '') +
      (incidents.length ? '<div style="font-weight:600;margin-bottom:6px">Incidents</div><table style="width:100%;font-size:13px"><tbody>' + incidents.map(function(i: any) {
        return '<tr><td style="padding:4px 0">' + escapeHtml(dateFr(i.date_incident)) + '</td><td>' + escapeHtml(String(i.type || '').replace(/_/g, ' ')) +
          (i.gravite ? ' <span class="badge bw">' + escapeHtml(i.gravite) + '</span>' : '') + '</td></tr>';
      }).join('') + '</tbody></table>' : ''));
  },
};

(window as any).PageFicheEleve = PageFicheEleve;
PAGE_HOOKS['fiche-eleve'] = () => PageFicheEleve.charger().catch((e: any) => toast(e.message || 'Fiche indisponible', 'e'));
