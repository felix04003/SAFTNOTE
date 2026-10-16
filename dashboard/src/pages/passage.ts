import { Api } from '../api';
import { escapeHtml, toast } from '../ui';
import { PAGE_HOOKS, goto } from '../router';

/**
 * Fin d'année et réinscription : une décision par élève (admis, redouble, diplômé, transfert, abandon, exclusion),
 * puis un seul envoi qui clôture l'année en cours et ouvre la suivante. Rien n'est écrit tant que le directeur n'a
 * pas confirmé. Les identifiants seuls passent dans les attributs HTML (règle 21).
 */

export interface EleveApercu {
  inscription_id: string; nom: string; prenom: string; matricule?: string;
  moyenne_annuelle: number | null; decision_conseil: string | null; sans_moyenne: boolean; proposition: string;
}
export interface Cible { niveau_id: string; niveau: string; nom: string; libelle: string }
export interface ClasseApercu {
  classe_id: string; libelle: string; dernier_niveau: boolean;
  cible_admis: Cible | null; cibles_possibles: Cible[]; eleves: EleveApercu[];
}

const LIBELLES: Record<string, string> = {
  admis: 'Passe au niveau suivant', redouble: 'Redouble', diplome: 'Diplômé',
  transfere: 'Transfert', abandonne: 'Abandon', exclu: 'Exclu',
};

/** Décisions possibles : on ne « passe » pas au-delà du dernier niveau, on n'y est « diplômé » qu'à ce niveau. */
export function decisionsPossibles(dernierNiveau: boolean): string[] {
  return [dernierNiveau ? 'diplome' : 'admis', 'redouble', 'transfere', 'abandonne', 'exclu'];
}

export function libelleDecision(decision: string): string { return LIBELLES[decision] || decision; }

export interface Choix { decision: string; cible?: string }       // cible = « niveau_id|nom » choisie ≠ défaut

export function resume(classes: ClasseApercu[], choix: Record<string, Choix>) {
  const r = { total: 0, admis: 0, redouble: 0, diplome: 0, sorties: 0 };
  for (const c of classes) for (const e of c.eleves) {
    const d = (choix[e.inscription_id] || { decision: e.proposition }).decision;
    r.total++;
    if (d === 'admis') r.admis++; else if (d === 'redouble') r.redouble++; else if (d === 'diplome') r.diplome++; else r.sorties++;
  }
  return r;
}

/** Corps du POST : toutes les décisions ; la classe d'accueil n'est envoyée que si elle diffère du défaut. */
export function construireDecisions(classes: ClasseApercu[], choix: Record<string, Choix>) {
  const lignes: any[] = [];
  for (const c of classes) for (const e of c.eleves) {
    const ch = choix[e.inscription_id] || { decision: e.proposition };
    const ligne: any = { inscription_id: e.inscription_id, decision: ch.decision };
    if (ch.decision === 'admis' && ch.cible) {
      const [niveau_id, ...reste] = ch.cible.split('|');
      ligne.classe_cible = { niveau_id, nom: reste.join('|') };
    }
    lignes.push(ligne);
  }
  return lignes;
}

export const PagePassage: any = {
  _donnees: null as any,
  _choix: {} as Record<string, Choix>,
  _envoi: false,

  async charger() {
    const seuil = (document.getElementById('psg-seuil') as HTMLInputElement | null)?.value || '10';
    const conteneur = document.getElementById('psg-classes');
    if (conteneur) conteneur.innerHTML = '<div style="padding:20px;color:var(--g400)">Chargement…</div>';
    try {
      const res = await Api.get('/annees-scolaires/passage/apercu', { seuil });
      this._donnees = res.data;
      this._choix = {};
      const p = this._donnees.proposition_annee;
      const champ = (id: string, v: any) => { const el = document.getElementById(id) as HTMLInputElement | null; if (el && !el.dataset.modifie) el.value = String(v); };
      champ('psg-libelle', p.libelle); champ('psg-debut', p.date_debut); champ('psg-fin', p.date_fin); champ('psg-nb', p.nb_periodes);
      const titre = document.getElementById('psg-annee-courante');
      if (titre) titre.textContent = this._donnees.annee.libelle;
      this.rendre();
    } catch (e: any) {
      if (conteneur) conteneur.innerHTML = '<div style="padding:20px;color:var(--rouge)">' + escapeHtml(e.message || 'Aperçu indisponible') + '</div>';
    }
  },

  rendre() {
    const d = this._donnees;
    const conteneur = document.getElementById('psg-classes');
    if (!d || !conteneur) return;
    if (!d.classes.length) {
      conteneur.innerHTML = '<div style="padding:20px;color:var(--g400)">Aucune classe dans l\'année en cours.</div>';
    } else {
      conteneur.innerHTML = d.classes.map((c: ClasseApercu) => this.rendreClasse(c)).join('');
    }
    this.rendreResume();
  },

  rendreClasse(c: ClasseApercu): string {
    const options = decisionsPossibles(c.dernier_niveau);
    const lignes = c.eleves.map((e) => {
      const choix = this._choix[e.inscription_id] || { decision: e.proposition };
      const id = escapeHtml(e.inscription_id);
      const moyenne = e.moyenne_annuelle === null ? '<span class="badge bn" title="Aucune moyenne calculée">sans moyenne</span>' : e.moyenne_annuelle + '/20';
      const conseil = e.decision_conseil ? ' <span class="badge bo" style="font-size:10px">conseil : ' + escapeHtml(e.decision_conseil) + '</span>' : '';
      const selection = '<select class="fs" style="width:190px" onchange="PagePassage.changer(\'' + id + '\', this.value)">' +
        options.map((o) => '<option value="' + o + '"' + (o === choix.decision ? ' selected' : '') + '>' + libelleDecision(o) + '</option>').join('') + '</select>';
      let cible = '';
      if (choix.decision === 'admis' && c.cibles_possibles.length) {
        cible = '<select class="fs" style="width:130px" onchange="PagePassage.changerCible(\'' + id + '\', this.value)">' +
          c.cibles_possibles.map((t, i) => {
            const valeur = t.niveau_id + '|' + t.nom;
            const actuelle = choix.cible ? choix.cible === valeur : i === 0;
            return '<option value="' + escapeHtml(valeur) + '"' + (actuelle ? ' selected' : '') + '>' + escapeHtml(t.libelle) + '</option>';
          }).join('') + '</select>';
      } else if (choix.decision === 'redouble') {
        cible = '<span style="font-size:12px;color:var(--g500)">' + escapeHtml(c.libelle) + '</span>';
      }
      return '<tr><td class="nc">' + escapeHtml(e.prenom + ' ' + e.nom) + conseil + '</td><td>' + moyenne + '</td><td>' + selection + '</td><td>' + cible + '</td></tr>';
    }).join('');
    const cid = escapeHtml(c.classe_id);
    const tous = c.dernier_niveau ? 'diplome' : 'admis';
    return '<div class="carte" style="margin-bottom:14px"><div class="ch"><span class="ct">' + escapeHtml(c.libelle) + '</span>' +
      '<span style="margin-left:8px;font-size:12px;color:var(--g500)">' + c.eleves.length + ' élève' + (c.eleves.length > 1 ? 's' : '') + '</span>' +
      '<button class="btn btn-l btn-sm" style="margin-left:auto" onclick="PagePassage.toutDeLaClasse(\'' + cid + '\', \'' + tous + '\')">Tous : ' + libelleDecision(tous).toLowerCase() + '</button></div>' +
      '<div class="tw"><table><thead><tr><th>Élève</th><th>Moy. annuelle</th><th>Décision</th><th>Classe d\'accueil</th></tr></thead><tbody>' +
      (lignes || '<tr><td colspan="4" style="text-align:center;color:var(--g400);padding:16px">Aucun élève inscrit</td></tr>') + '</tbody></table></div></div>';
  },

  rendreResume() {
    const zone = document.getElementById('psg-resume');
    if (!zone || !this._donnees) return;
    const r = resume(this._donnees.classes, this._choix);
    zone.textContent = r.total + ' élève' + (r.total > 1 ? 's' : '') + ' : ' + r.admis + ' passent, ' + r.redouble + ' redoublent, ' +
      r.diplome + ' diplômé' + (r.diplome > 1 ? 's' : '') + ', ' + r.sorties + ' sortie' + (r.sorties > 1 ? 's' : '');
  },

  changer(inscriptionId: string, decision: string) {
    this._choix[inscriptionId] = { decision };           // un changement de décision remet la classe d'accueil par défaut
    this.rendre();
  },

  changerCible(inscriptionId: string, cible: string) {
    const actuel = this._choix[inscriptionId] || { decision: 'admis' };
    this._choix[inscriptionId] = { ...actuel, cible };
    this.rendreResume();
  },

  toutDeLaClasse(classeId: string, decision: string) {
    const c = this._donnees.classes.find((x: ClasseApercu) => x.classe_id === classeId);
    if (!c) return;
    for (const e of c.eleves) this._choix[e.inscription_id] = { decision };
    this.rendre();
  },

  /** Valeurs du formulaire de la nouvelle année, ou null (avec un message) si elles sont invalides */
  lireAnnee() {
    const val = (id: string) => ((document.getElementById(id) as HTMLInputElement | null)?.value || '').trim();
    const libelle = val('psg-libelle'), debut = val('psg-debut'), fin = val('psg-fin');
    if (!/^\d{4}-\d{4}$/.test(libelle)) { toast('Libellé de l\'année : 2026-2027', 'w'); return null; }
    if (!debut || !fin || fin <= debut) { toast('Les dates de l\'année sont invalides (la fin doit suivre le début)', 'w'); return null; }
    return {
      libelle, date_debut: debut, date_fin: fin,
      nb_periodes: parseInt(val('psg-nb'), 10) === 2 ? 2 : 3,
      copier_affectations: Boolean((document.getElementById('psg-affectations') as HTMLInputElement | null)?.checked),
    };
  },

  async confirmer() {
    if (this._envoi || !this._donnees) return;
    const annee = this.lireAnnee();
    if (!annee) return;
    const r = resume(this._donnees.classes, this._choix);
    if (!r.total) return toast('Aucun élève à reporter : utilisez la création d\'une année depuis les paramètres', 'w');
    const message = 'Clôturer l\'année ' + this._donnees.annee.libelle + ' et ouvrir ' + annee.libelle + ' ?\n\n' +
      r.admis + ' élève(s) passent, ' + r.redouble + ' redoublent, ' + r.diplome + ' diplômé(s), ' + r.sorties + ' sortie(s).\n\n' +
      'Les notes et bulletins de ' + this._donnees.annee.libelle + ' sont conservés. L\'opération ne peut pas être annulée.';
    if (!confirm(message)) return;

    this._envoi = true;
    const bouton = document.getElementById('psg-confirmer') as HTMLButtonElement | null;
    if (bouton) bouton.disabled = true;
    try {
      const res = await Api.post('/annees-scolaires/passage', { ...annee, decisions: construireDecisions(this._donnees.classes, this._choix) });
      const c = res.data || {};
      toast('Année ' + (c.libelle || annee.libelle) + ' ouverte : ' + (c.reinscrits ?? 0) + ' élève(s) réinscrit(s) ✓', 's');
      this._donnees = null; this._choix = {};
      goto('dashboard');
    } catch (e: any) {
      toast(e.message || 'Le passage d\'année a échoué (rien n\'a été modifié)', 'e');
    } finally {
      this._envoi = false;
      if (bouton) bouton.disabled = false;
    }
  },

  init() { this.charger(); },
};

(window as any).PagePassage = PagePassage;
PAGE_HOOKS['passage'] = () => PagePassage.init();
