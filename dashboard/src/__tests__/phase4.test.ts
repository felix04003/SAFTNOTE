import { describe, it, expect, beforeEach, vi } from 'vitest';
import loginHtml from '../../login.html?raw';
import enseignantHtml from '../../enseignant.html?raw';
import { Auth } from '../auth';
import { Api } from '../api';
import { CONFIG } from '../config';
import { appliquerEtatReseau, MESSAGE_HORS_LIGNE } from '../reseau';

describe('4.1 Auth.populateSidebar (C6)', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML =
      '<div id="sb-etab-nom"></div><div id="sb-user-avatar">?</div>' +
      '<div id="sb-user-nom"></div><div id="sb-user-role"></div>';
  });

  it('renseigne nom, rôle, initiale et établissement', () => {
    localStorage.setItem(CONFIG.USER_KEY, JSON.stringify({
      prenom: 'Awa', nom: 'Diop', role: 'enseignant', etablissement_nom: 'Lycée Test',
    }));
    Auth.populateSidebar();
    expect(document.getElementById('sb-user-nom')!.textContent).toBe('Awa Diop');
    expect(document.getElementById('sb-user-role')!.textContent).toBe('enseignant');
    expect(document.getElementById('sb-user-avatar')!.textContent).toBe('A');
    expect(document.getElementById('sb-etab-nom')!.textContent).toBe('Lycée Test');
  });
});

describe('4.2 lien parent sur login.html (C7)', () => {
  it('pointe vers parent-login.html', () => {
    expect(loginHtml).toMatch(/<a id="lien-parent" href="parent-login\.html"/);
  });
});

describe('4.3 bandeau hors connexion (C8)', () => {
  beforeEach(() => { document.body.className = ''; document.body.innerHTML = '<button data-requiert-reseau>OK</button>'; });

  it('affiche le bandeau et marque les boutons hors ligne, puis les libère', () => {
    appliquerEtatReseau(false);
    expect(document.getElementById('bandeau-hors-ligne')!.textContent).toBe(MESSAGE_HORS_LIGNE);
    expect(document.body.classList.contains('hors-ligne')).toBe(true);
    expect(document.querySelector('button')!.getAttribute('aria-disabled')).toBe('true');

    appliquerEtatReseau(false); // pas de doublon
    expect(document.querySelectorAll('#bandeau-hors-ligne')).toHaveLength(1);

    appliquerEtatReseau(true);
    expect(document.getElementById('bandeau-hors-ligne')).toBeNull();
    expect(document.querySelector('button')!.hasAttribute('aria-disabled')).toBe(false);
  });

  it('les boutons d\'enregistrement de enseignant.html sont marqués', () => {
        for (const id of ['btn-appel-soumettre', 'btn-ens-sauver-notes', 'btn-ens-publier-notes', 'btn-ens-creer-eval', 'btn-disc-creer']) {
      expect(enseignantHtml).toMatch(new RegExp(`id="${id}" data-requiert-reseau`));
    }
  });
});

describe('4.4 session fermée (C9)', () => {
  beforeEach(() => { sessionStorage.clear(); });

  it('SESSION_REVOQUEE au refresh : le message est conservé pour la page de connexion', async () => {
    sessionStorage.setItem(CONFIG.REFRESH_TOKEN_KEY, 'ancien');
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false, status: 401,
      json: async () => ({ code: 'SESSION_REVOQUEE', erreur: "Vous avez été déconnecté : trop d'appareils" }),
    } as Response);
    expect(await Api.tenterRafraichissement()).toBe(false);
    expect(sessionStorage.getItem(CONFIG.FLASH_KEY)).toMatch(/trop d'appareils/);
  });

  it('un autre échec ne laisse aucun message', async () => {
    sessionStorage.setItem(CONFIG.REFRESH_TOKEN_KEY, 'ancien');
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ code: 'NON_AUTORISE' }) } as Response);
    expect(await Api.tenterRafraichissement()).toBe(false);
    expect(sessionStorage.getItem(CONFIG.FLASH_KEY)).toBeNull();
  });
});
