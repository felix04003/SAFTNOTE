import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Api } from '../api';
import { PageBulletins } from '../pages/bulletins';

const periodes = [
  { id: 'p1', numero: 1, libelle: 'Trimestre 1', date_debut: '2026-10-01', date_fin: '2026-12-20' },
  { id: 'p2', numero: 2, libelle: 'Trimestre 2', date_debut: '2027-01-05', date_fin: '2027-03-30' },
  { id: 'p3', numero: 3, libelle: 'Trimestre 3', date_debut: '2027-04-10', date_fin: '2027-06-30' },
];

describe('PageBulletins.periodeParDefaut', () => {
  it('prend la période qui contient aujourd\'hui', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2027-02-10'));
    expect(PageBulletins._periodeParDefaut(periodes)).toBe('p2');
    vi.useRealTimers();
  });

  it('entre deux périodes : la dernière commencée', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2027-01-01'));
    expect(PageBulletins._periodeParDefaut(periodes)).toBe('p1');
    vi.useRealTimers();
  });

  it('avant la première : la première ; sans période : vide', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-01'));
    expect(PageBulletins._periodeParDefaut(periodes)).toBe('p1');
    vi.useRealTimers();
    expect(PageBulletins._periodeParDefaut([])).toBe('');
  });
});

describe('PageBulletins — génération', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div class="tc" id="tc"></div><select id="bull-periode"></select><tbody id="tb-bull"></tbody>';
    PageBulletins._periodes = periodes;
    PageBulletins._periodeId = 'p2';
    PageBulletins._occupe = false;
    PageBulletins.data = [
      { id: 'c1', classe: '6ème A', effectif: 30, generes: 0 },
      { id: 'c2', classe: '5ème B', effectif: 28, generes: 28 },     // déjà faite : ignorée
      { id: 'c3', classe: '4ème C', effectif: 25, generes: 10 },
      { id: 'c4', classe: '3ème D', effectif: 0,  generes: 0 },      // vide : ignorée
    ];
    window.confirm = vi.fn().mockReturnValue(true);
    vi.spyOn(PageBulletins, 'charger').mockResolvedValue(true);
  });

  it('calcule les moyennes PUIS génère, pour chaque classe incomplète seulement, sur la période choisie', async () => {
    const post = vi.spyOn(Api, 'post').mockImplementation(async (chemin: string) =>
      (chemin === '/bulletins/generer' ? { data: { nb_bulletins: 12 } } : { data: {} }) as any);

    await PageBulletins.genererTous();

    expect(post.mock.calls.map((c) => [c[0], (c[1] as any).classe_id, (c[1] as any).periode_id])).toEqual([
      ['/moyennes/calculer', 'c1', 'p2'], ['/bulletins/generer', 'c1', 'p2'],
      ['/moyennes/calculer', 'c3', 'p2'], ['/bulletins/generer', 'c3', 'p2'],
    ]);
    expect(document.body.textContent).toContain('24 bulletin(s) généré(s)');
  });

  it('une classe sans moyenne n\'arrête pas les autres et le dit', async () => {
    vi.spyOn(Api, 'post').mockImplementation(async (chemin: string, corps: any) => {
      if (chemin === '/bulletins/generer' && corps.classe_id === 'c1') throw new Error('Aucune moyenne calculée');
      return { data: { nb_bulletins: 5 } } as any;
    });

    await PageBulletins.genererTous();

    expect(document.body.textContent).toContain('5 bulletin(s) généré(s)');
    expect(document.body.textContent).toContain('1 classe(s) non générée(s)');
    expect(document.body.textContent).toContain('6ème A : Aucune moyenne calculée');
  });

  it('rien à faire : aucun appel serveur', async () => {
    PageBulletins.data = [{ id: 'c2', classe: '5ème B', effectif: 28, generes: 28 }];
    const post = vi.spyOn(Api, 'post');
    await PageBulletins.genererTous();
    expect(post).not.toHaveBeenCalled();
  });

  it('un second clic pendant la génération est ignoré', async () => {
    PageBulletins._occupe = true;
    const post = vi.spyOn(Api, 'post');
    await PageBulletins.genererTous();
    expect(post).not.toHaveBeenCalled();
  });

  it('refus de confirmer : rien n\'est lancé', async () => {
    window.confirm = vi.fn().mockReturnValue(false);
    const post = vi.spyOn(Api, 'post');
    await PageBulletins.genererTous();
    expect(post).not.toHaveBeenCalled();
  });
});

describe('PageBulletins.renderTable', () => {
  beforeEach(() => { document.body.innerHTML = '<table><tbody id="tb-bull"></tbody></table>'; });

  it('compteurs reçus en texte (COUNT PostgreSQL) : « Valider » proposé quand rien n\'est validé, « Générer » quand tout n\'est pas généré', () => {
    PageBulletins.renderTable([
      { id: 'c1', classe: '6ème A', effectif: '30', generes: '30', valides: '0' },
      { id: 'c2', classe: '5ème B', effectif: '28', generes: '10', valides: '0' },
      { id: 'c3', classe: '4ème C', effectif: '25', generes: '25', valides: '25' },
    ]);
    const ligne = (n: number) => document.querySelectorAll('#tb-bull tr')[n].textContent || '';
    expect(ligne(0)).toContain('Valider');
    expect(ligne(0)).not.toContain('Générer');
    expect(ligne(1)).toContain('Générer');
    expect(ligne(2)).not.toContain('Valider');
    expect(ligne(2)).not.toContain('Générer');
  });
});
