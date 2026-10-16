import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Api } from '../api';
import { PageParBulletins } from '../pages/par-bulletins';

const ANNEES = [{ id: 'a2', libelle: '2026-2027', est_courante: true }, { id: 'a1', libelle: '2025-2026', est_courante: false }];
const reponse = (extra: any = {}) => ({ data: { enfant: { classe: '6ème A' }, annee: '2026-2027', annee_id: 'a2', annees: ANNEES, bulletins: [], ...extra } });

beforeEach(() => {
  document.body.innerHTML = '<span id="par-bulletins-sous"></span><select id="par-bulletins-annee" style="display:none"></select><div id="par-bulletins-liste"></div>';
  (window as any).ParApp = { enfantId: () => 'u1', enfantLien: () => ({ peut_voir_bulletins: true }) };
  (globalThis as any).ParApp = (window as any).ParApp;
  PageParBulletins._anneeId = '';
});
afterEach(() => { vi.restoreAllMocks(); });

describe('PageParBulletins — années', () => {
  it('par défaut : pas de paramètre ; le sélecteur propose les années, la courante cochée', async () => {
    const get = vi.spyOn(Api, 'get').mockResolvedValue(reponse() as any);
    await PageParBulletins.init();
    expect(get).toHaveBeenCalledWith('/parents/moi/enfants/u1/bulletins', undefined);
    const sel = document.getElementById('par-bulletins-annee') as HTMLSelectElement;
    expect(sel.style.display).toBe('');
    expect([...sel.options].map((o) => o.textContent)).toEqual(['2026-2027', '2025-2026']);
    expect(sel.value).toBe('a2');
  });

  it('une seule année d\'historique : pas de sélecteur', async () => {
    vi.spyOn(Api, 'get').mockResolvedValue(reponse({ annees: [ANNEES[0]] }) as any);
    await PageParBulletins.init();
    expect((document.getElementById('par-bulletins-annee') as HTMLElement).style.display).toBe('none');
  });

  it('choisir une ancienne année redemande avec annee_id et affiche ses bulletins', async () => {
    const get = vi.spyOn(Api, 'get')
      .mockResolvedValueOnce(reponse() as any)
      .mockResolvedValueOnce(reponse({ annee: '2025-2026', annee_id: 'a1', bulletins: [{ periode: 'Trimestre 1', trimestre: 1, moyenne_generale: 14, mention: 'Bien', matieres: [] }] }) as any);
    await PageParBulletins.init();
    await PageParBulletins.changerAnnee('a1');
    expect(get).toHaveBeenLastCalledWith('/parents/moi/enfants/u1/bulletins', { annee_id: 'a1' });
    expect(document.getElementById('par-bulletins-liste')!.textContent).toContain('Trimestre 1');
    expect(document.getElementById('par-bulletins-sous')!.textContent).toContain('2025-2026');
    expect((document.getElementById('par-bulletins-annee') as HTMLSelectElement).value).toBe('a1');
  });

  it('changer d\'enfant (init) revient à l\'année par défaut', async () => {
    const get = vi.spyOn(Api, 'get').mockResolvedValue(reponse() as any);
    PageParBulletins._anneeId = 'a1';
    await PageParBulletins.init();
    expect(get).toHaveBeenCalledWith('/parents/moi/enfants/u1/bulletins', undefined);
  });
});
