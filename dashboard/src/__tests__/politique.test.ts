import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PageParametres } from '../pages/parametres';
import { CONFIG } from '../config';

const CARTE = `
  <div class="login-err" id="politique-err"></div>
  <input id="pol-mdp-longueur"><input id="pol-sessions"><input id="pol-tentatives"><input id="pol-blocage">
  <button id="btn-politique-save">Enregistrer</button>`;
const champ = (id: string) => document.getElementById(id) as HTMLInputElement;
const remplir = (v: Record<string, string>) => Object.entries(v).forEach(([id, val]) => { champ(id).value = val; });
const VALIDE = { 'pol-mdp-longueur': '10', 'pol-sessions': '4', 'pol-tentatives': '6', 'pol-blocage': '30' };

describe('politique de sécurité (2.4)', () => {
  beforeEach(() => {
    document.body.innerHTML = CARTE;
    sessionStorage.setItem(CONFIG.TOKEN_KEY, 't');
  });

  it('chargerPolitique remplit les quatre champs', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      status: 200, ok: true,
      json: async () => ({ data: { mdp_longueur_min: 10, session_max_simultanees: 5, blocage_nb_tentatives: 4, blocage_duree_minutes: 20 } }),
    } as Response);
    await PageParametres.chargerPolitique();
    expect([champ('pol-mdp-longueur').value, champ('pol-sessions').value, champ('pol-tentatives').value, champ('pol-blocage').value])
      .toEqual(['10', '5', '4', '20']);
  });

  it('refus du serveur au chargement (pas de permission) : bouton désactivé', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ status: 403, ok: false, json: async () => ({ erreur: 'Permission requise', code: 'PERMISSION_INSUFFISANTE' }) } as Response);
    await PageParametres.chargerPolitique();
    expect((document.getElementById('btn-politique-save') as HTMLButtonElement).disabled).toBe(true);
  });

  it.each([
    ['mot de passe trop court', { 'pol-mdp-longueur': '7' }, /longueur du mot de passe/],
    ['sessions à 0', { 'pol-sessions': '0' }, /nombre d'appareils/],
    ['tentatives à 11', { 'pol-tentatives': '11' }, /nombre de tentatives/],
    ['blocage de 4 minutes', { 'pol-blocage': '4' }, /durée du blocage/],
    ['valeur décimale', { 'pol-blocage': '10.5' }, /durée du blocage/],
    ['champ vide', { 'pol-sessions': '' }, /nombre d'appareils/],
  ])('validation locale : %s → message, aucune requête', async (_nom, modif, message) => {
    remplir({ ...VALIDE, ...modif });
    vi.mocked(fetch).mockClear();
    await PageParametres.sauvegarderPolitique();
    expect(fetch).not.toHaveBeenCalled();
    const err = document.getElementById('politique-err')!;
    expect(err.classList.contains('show')).toBe(true);
    expect(err.textContent).toMatch(message);
  });

  it('enregistrement : PUT avec les quatre valeurs entières', async () => {
    remplir(VALIDE);
    vi.mocked(fetch).mockResolvedValueOnce({ status: 200, ok: true, json: async () => ({ data: {} }) } as Response);
    await PageParametres.sauvegarderPolitique();
    const appels = vi.mocked(fetch).mock.calls;
    const [url, opts] = appels[appels.length - 1];
    expect(String(url)).toMatch(/\/securite\/politique$/);
    expect((opts as RequestInit).method).toBe('PUT');
    expect(JSON.parse((opts as RequestInit).body as string)).toEqual({
      mdp_longueur_min: 10, session_max_simultanees: 4, blocage_nb_tentatives: 6, blocage_duree_minutes: 30,
    });
    expect(document.getElementById('politique-err')!.classList.contains('show')).toBe(false);
  });

  it('erreur du serveur : son message est affiché et le bouton se réactive', async () => {
    remplir(VALIDE);
    vi.mocked(fetch).mockResolvedValueOnce({ status: 403, ok: false, json: async () => ({ erreur: 'Permission requise : config.modifier' }) } as Response);
    await PageParametres.sauvegarderPolitique();
    expect(document.getElementById('politique-err')!.textContent).toBe('Permission requise : config.modifier');
    expect((document.getElementById('btn-politique-save') as HTMLButtonElement).disabled).toBe(false);
  });
});
