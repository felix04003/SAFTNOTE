import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Api } from '../api';
import { CONFIG } from '../config';

const ATTENTE = Symbol('toujours en attente');
const apresDelai = (p: Promise<unknown>, ms = 40) =>
  Promise.race([p, new Promise((r) => setTimeout(() => r(ATTENTE), ms))]);

function reponseDifferee() {
  let livrer!: (r: Partial<Response>) => void;
  const promesse = new Promise<Response>((resolve) => { livrer = (r) => resolve(r as Response); });
  return { promesse, livrer };
}
const ok = (data: unknown) => ({ status: 200, ok: true, json: async () => ({ data }) });

describe('protection contre les requêtes en vol (bascule d\'école)', () => {
  beforeEach(() => { sessionStorage.setItem(CONFIG.TOKEN_KEY, 't1'); });

  it('une requête terminée APRÈS une bascule n\'est jamais livrée à son appelant', async () => {
    const d = reponseDifferee();
    vi.mocked(fetch).mockImplementationOnce(() => d.promesse);

    const enVol = Api.get('/parents/moi/tableau-de-bord');
    Api.nouvelleGeneration();                 // bascule d'école pendant la requête
    d.livrer(ok([{ enfant: 'Moussa' }]));

    expect(await apresDelai(enVol)).toBe(ATTENTE);
  });

  it('une requête lancée APRÈS la bascule est livrée normalement', async () => {
    Api.nouvelleGeneration();
    vi.mocked(fetch).mockResolvedValueOnce(ok(['Aida']) as Response);
    const res = await Api.get('/parents/moi/enfants');
    expect(res.data).toEqual(['Aida']);
  });

  it('une requête sans bascule pendant son vol est livrée normalement', async () => {
    const d = reponseDifferee();
    vi.mocked(fetch).mockImplementationOnce(() => d.promesse);
    const enVol = Api.get('/notifications');
    d.livrer(ok({ total: 3 }));
    expect((await enVol).data).toEqual({ total: 3 });
  });

  it('un 401 périmé ne purge pas la session de la nouvelle école ni ne tente de refresh', async () => {
    sessionStorage.setItem(CONFIG.REFRESH_TOKEN_KEY, 'r1');
    const d = reponseDifferee();
    vi.mocked(fetch).mockClear();
    vi.mocked(fetch).mockImplementationOnce(() => d.promesse);

    const enVol = Api.get('/notifications');
    Api.nouvelleGeneration();
    sessionStorage.setItem(CONFIG.TOKEN_KEY, 't2');          // session de la nouvelle école
    sessionStorage.setItem(CONFIG.REFRESH_TOKEN_KEY, 'r2');
    d.livrer({ status: 401, ok: false, json: async () => ({ code: 'NON_AUTORISE' }) });

    expect(await apresDelai(enVol)).toBe(ATTENTE);
    expect(sessionStorage.getItem(CONFIG.TOKEN_KEY)).toBe('t2');
    expect(sessionStorage.getItem(CONFIG.REFRESH_TOKEN_KEY)).toBe('r2');
    expect(fetch).toHaveBeenCalledTimes(1);                  // aucun POST /auth/refresh
  });

  it('une erreur serveur périmée n\'arrive pas non plus à l\'appelant (pas de toast d\'erreur de l\'ancienne école)', async () => {
    const d = reponseDifferee();
    vi.mocked(fetch).mockImplementationOnce(() => d.promesse);
    const enVol = Api.get('/parents/moi/notes').catch(() => 'erreur livrée');
    Api.nouvelleGeneration();
    d.livrer({ status: 500, ok: false, json: async () => ({ erreur: 'Erreur serveur' }) });
    expect(await apresDelai(enVol)).toBe(ATTENTE);
  });
});
