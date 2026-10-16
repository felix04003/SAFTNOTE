import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Api } from '../api';
import { PagePassage, decisionsPossibles, libelleDecision, resume, construireDecisions } from '../pages/passage';

const eleve = (id: string, extra: any = {}) => ({
  inscription_id: id, nom: 'Diop', prenom: 'Awa', moyenne_annuelle: 12, decision_conseil: null, sans_moyenne: false, proposition: 'admis', ...extra,
});
const cibles = [
  { niveau_id: 'n2', niveau: '5ème', nom: 'A', libelle: '5ème A' },
  { niveau_id: 'n2', niveau: '5ème', nom: 'B', libelle: '5ème B' },
];
function apercu() {
  return {
    annee: { id: 'a1', libelle: '2025-2026', date_debut: '2025-10-01', date_fin: '2026-07-15', nb_periodes: 3 },
    proposition_annee: { libelle: '2026-2027', date_debut: '2026-10-01', date_fin: '2027-07-15', nb_periodes: 3 },
    total_eleves: 3,
    classes: [
      { classe_id: 'c1', libelle: '6ème A', dernier_niveau: false, cible_admis: cibles[0], cibles_possibles: cibles,
        eleves: [eleve('i1'), eleve('i2', { moyenne_annuelle: 6, proposition: 'redouble' })] },
      { classe_id: 'c2', libelle: 'Terminale A', dernier_niveau: true, cible_admis: null, cibles_possibles: [],
        eleves: [eleve('i3', { proposition: 'diplome', moyenne_annuelle: null, sans_moyenne: true })] },
    ],
  };
}

const PAGE = '<div id="tc"></div><b id="psg-annee-courante"></b><input id="psg-libelle"><input id="psg-debut" type="date"><input id="psg-fin" type="date">' +
  '<select id="psg-nb"><option value="3">3</option><option value="2">2</option></select><input id="psg-affectations" type="checkbox" checked><input id="psg-edt" type="checkbox" checked>' +
  '<input id="psg-seuil" value="10"><div id="psg-resume"></div><div id="psg-classes"></div><button id="psg-confirmer"></button><div class="page" id="page-dashboard"></div>';

beforeEach(() => { document.body.innerHTML = PAGE; PagePassage._donnees = null; PagePassage._choix = {}; PagePassage._envoi = false; });
afterEach(() => { vi.restoreAllMocks(); });

describe('fonctions pures', () => {
  it('Décisions possibles : « diplômé » seulement au dernier niveau, « passe » partout ailleurs', () => {
    expect(decisionsPossibles(false)).toEqual(['admis', 'redouble', 'transfere', 'abandonne', 'exclu']);
    expect(decisionsPossibles(true)).toEqual(['diplome', 'redouble', 'transfere', 'abandonne', 'exclu']);
    expect(libelleDecision('admis')).toBe('Passe au niveau suivant');
  });

  it('résumé : les propositions tant que rien n\'est changé, puis les choix', () => {
    const { classes } = apercu();
    expect(resume(classes as any, {})).toEqual({ total: 3, admis: 1, redouble: 1, diplome: 1, sorties: 0 });
    expect(resume(classes as any, { i2: { decision: 'exclu' }, i3: { decision: 'transfere' } })).toEqual({ total: 3, admis: 1, redouble: 0, diplome: 0, sorties: 2 });
  });

  it('corps du POST : une décision par élève ; la classe d\'accueil seulement si elle a été choisie', () => {
    const { classes } = apercu();
    expect(construireDecisions(classes as any, {})).toEqual([
      { inscription_id: 'i1', decision: 'admis' }, { inscription_id: 'i2', decision: 'redouble' }, { inscription_id: 'i3', decision: 'diplome' },
    ]);
    const avecCible = construireDecisions(classes as any, { i1: { decision: 'admis', cible: 'n2|B' } });
    expect(avecCible[0]).toEqual({ inscription_id: 'i1', decision: 'admis', classe_cible: { niveau_id: 'n2', nom: 'B' } });
    // une cible n'a de sens que pour « admis »
    expect(construireDecisions(classes as any, { i1: { decision: 'redouble', cible: 'n2|B' } })[0]).not.toHaveProperty('classe_cible');
  });
});

describe('page', () => {
  async function ouvrir() {
    vi.spyOn(Api, 'get').mockResolvedValue({ data: apercu() } as any);
    await PagePassage.charger();
  }

  it('charge l\'aperçu, préremplit la nouvelle année et affiche une ligne par élève', async () => {
    await ouvrir();
    expect(Api.get).toHaveBeenCalledWith('/annees-scolaires/passage/apercu', { seuil: '10' });
    expect((document.getElementById('psg-libelle') as HTMLInputElement).value).toBe('2026-2027');
    expect((document.getElementById('psg-debut') as HTMLInputElement).value).toBe('2026-10-01');
    expect(document.querySelectorAll('#psg-classes tbody tr')).toHaveLength(3);
    expect(document.getElementById('psg-resume')!.textContent).toContain('3 élèves : 1 passent, 1 redoublent, 1 diplômé');
    expect(document.getElementById('psg-classes')!.textContent).toContain('sans moyenne');
  });

  it('ce que l\'utilisateur a tapé n\'est pas écrasé par un rechargement (changement de seuil)', async () => {
    await ouvrir();
    const libelle = document.getElementById('psg-libelle') as HTMLInputElement;
    libelle.value = '2026-2028'; libelle.dataset.modifie = '1';
    await PagePassage.charger();
    expect(libelle.value).toBe('2026-2028');
  });

  it('changer une décision met le résumé à jour ; la classe d\'accueil n\'est proposée que pour « passe »', async () => {
    await ouvrir();
    PagePassage.changer('i1', 'exclu');
    expect(document.getElementById('psg-resume')!.textContent).toContain('0 passent, 1 redoublent');
    expect(document.querySelectorAll('#psg-classes select[onchange*="changerCible"]')).toHaveLength(0);
    PagePassage.changer('i1', 'admis');
    expect(document.querySelectorAll('#psg-classes select[onchange*="changerCible"]')).toHaveLength(1);
  });

  it('« Tous : … » applique une décision à toute la classe', async () => {
    await ouvrir();
    PagePassage.toutDeLaClasse('c1', 'admis');
    expect(document.getElementById('psg-resume')!.textContent).toContain('2 passent, 0 redoublent');
  });

  it('un nom piégé ne peut pas sortir de l\'affichage (pas de HTML injecté, seuls les identifiants sont dans les attributs)', async () => {
    const donnees = apercu();
    donnees.classes[0].eleves[0] = eleve('i1', { prenom: '<img src=x onerror=window.__pwn=1>', nom: "N'Diaye" });
    vi.spyOn(Api, 'get').mockResolvedValue({ data: donnees } as any);
    await PagePassage.charger();
    expect(document.querySelector('#psg-classes img')).toBeNull();
    expect(document.getElementById('psg-classes')!.textContent).toContain("N'Diaye");
    expect((window as any).__pwn).toBeUndefined();
    for (const el of Array.from(document.querySelectorAll('#psg-classes [onclick], #psg-classes [onchange]'))) {
      expect((el.getAttribute('onclick') || el.getAttribute('onchange') || '')).not.toMatch(/Diaye|img/);
    }
  });

  describe('confirmer', () => {
    it('libellé ou dates invalides : aucun envoi', async () => {
      await ouvrir();
      const post = vi.spyOn(Api, 'post');
      window.confirm = vi.fn().mockReturnValue(true);
      (document.getElementById('psg-libelle') as HTMLInputElement).value = '2026';
      await PagePassage.confirmer();
      (document.getElementById('psg-libelle') as HTMLInputElement).value = '2026-2027';
      (document.getElementById('psg-fin') as HTMLInputElement).value = '2026-09-01';          // avant le début
      await PagePassage.confirmer();
      expect(post).not.toHaveBeenCalled();
    });

    it('confirmation refusée : aucun envoi', async () => {
      await ouvrir();
      const post = vi.spyOn(Api, 'post');
      window.confirm = vi.fn().mockReturnValue(false);
      await PagePassage.confirmer();
      expect(post).not.toHaveBeenCalled();
    });

    it('envoie toutes les décisions et les paramètres de l\'année, puis revient au tableau de bord', async () => {
      await ouvrir();
      const post = vi.spyOn(Api, 'post').mockResolvedValue({ data: { libelle: '2026-2027', reinscrits: 2 } } as any);
      window.confirm = vi.fn().mockReturnValue(true);
      PagePassage.changer('i1', 'admis');
      PagePassage.changerCible('i1', 'n2|B');
      (document.getElementById('psg-nb') as HTMLSelectElement).value = '2';
      (document.getElementById('psg-affectations') as HTMLInputElement).checked = false;
      await PagePassage.confirmer();
      expect(String((window.confirm as any).mock.calls[0][0])).toContain('ne peut pas être annulée');
      expect(post).toHaveBeenCalledWith('/annees-scolaires/passage', {
        libelle: '2026-2027', date_debut: '2026-10-01', date_fin: '2027-07-15', nb_periodes: 2, copier_affectations: false, copier_edt: false,
        decisions: [
          { inscription_id: 'i1', decision: 'admis', classe_cible: { niveau_id: 'n2', nom: 'B' } },
          { inscription_id: 'i2', decision: 'redouble' },
          { inscription_id: 'i3', decision: 'diplome' },
        ],
      });
      expect(document.body.textContent).toContain('2 élève(s) réinscrit(s)');
      expect(document.getElementById('page-dashboard')!.classList.contains('active')).toBe(true);
    });

    it('emploi du temps : reconduit avec les affectations, jamais sans elles', () => {
      for (const [aff, edt, attendu] of [[true, true, true], [true, false, false], [false, true, false]] as const) {
        document.body.innerHTML = PAGE;
        (document.getElementById('psg-libelle') as HTMLInputElement).value = '2026-2027';
        (document.getElementById('psg-debut') as HTMLInputElement).value = '2026-10-01';
        (document.getElementById('psg-fin') as HTMLInputElement).value = '2027-07-15';
        (document.getElementById('psg-affectations') as HTMLInputElement).checked = aff;
        (document.getElementById('psg-edt') as HTMLInputElement).checked = edt;
        expect(PagePassage.lireAnnee()).toMatchObject({ copier_affectations: aff, copier_edt: attendu });
      }
    });

    it('décocher les affectations désactive et décoche l\'emploi du temps', () => {
      const aff = document.getElementById('psg-affectations') as HTMLInputElement;
      const edt = document.getElementById('psg-edt') as HTMLInputElement;
      aff.checked = false; PagePassage.majOptions();
      expect(edt.disabled).toBe(true); expect(edt.checked).toBe(false);
      aff.checked = true; PagePassage.majOptions();
      expect(edt.disabled).toBe(false);
    });

    it('échec du serveur : message affiché, rien n\'est perdu, le bouton redevient actif', async () => {
      await ouvrir();
      vi.spyOn(Api, 'post').mockRejectedValue(new Error('2 élève(s) inscrit(s) n\'ont pas de décision'));
      window.confirm = vi.fn().mockReturnValue(true);
      await PagePassage.confirmer();
      expect(document.body.textContent).toContain('n\'ont pas de décision');
      expect((document.getElementById('psg-confirmer') as HTMLButtonElement).disabled).toBe(false);
      expect(PagePassage._donnees).not.toBeNull();
      expect(PagePassage._envoi).toBe(false);
    });

    it('un double clic n\'envoie qu\'une fois', async () => {
      await ouvrir();
      let fin: () => void = () => {};
      const post = vi.spyOn(Api, 'post').mockImplementation(() => new Promise((r) => { fin = () => r({ data: {} } as any); }));
      window.confirm = vi.fn().mockReturnValue(true);
      const premier = PagePassage.confirmer();
      await PagePassage.confirmer();                   // second clic pendant l'envoi
      fin(); await premier;
      expect(post).toHaveBeenCalledTimes(1);
    });
  });
});
