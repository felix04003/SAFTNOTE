import { describe, it, expect, vi, beforeEach } from 'vitest';
import { goto, PAGE_HOOKS, TITRES } from '../router';

function setupDOM(pages: string[]) {
  document.body.innerHTML = `
    <div id="page-titre"></div>
    ${pages.map(id => `<div id="page-${id}" class="page" style="display:none"></div>`).join('\n')}
  `;
}

describe('TITRES', () => {
  it('contient les pages principales', () => {
    expect(TITRES['dashboard']).toBe('Tableau de bord');
    expect(TITRES['eleves']).toBe('Élèves');
    expect(TITRES['parametres']).toBe('Paramètres');
  });
});

describe('goto', () => {
  beforeEach(() => {
    setupDOM(['dashboard', 'eleves', 'notes']);
    Object.keys(PAGE_HOOKS).forEach(k => delete PAGE_HOOKS[k]);
  });

  it('masque toutes les pages .page', () => {
    const eleves = document.getElementById('page-eleves')!;
    eleves.style.display = '';
    goto('dashboard');
    expect(eleves.style.display).toBe('none');
  });

  it('affiche la page cible', () => {
    goto('eleves');
    const page = document.getElementById('page-eleves')!;
    expect(page.style.display).toBe('');
  });

  it('met à jour location.hash', () => {
    goto('notes');
    expect(location.hash).toBe('notes');
  });

  it('met à jour le titre avec TITRES[id]', () => {
    goto('eleves');
    const titre = document.getElementById('page-titre')!;
    expect(titre.textContent).toBe('Élèves');
  });

  it('utilise id comme titre de secours si absent de TITRES', () => {
    document.body.innerHTML += '<div id="page-custom" class="page"></div>';
    goto('custom');
    const titre = document.getElementById('page-titre')!;
    expect(titre.textContent).toBe('custom');
  });

  it('déclenche le hook PAGE_HOOKS[id] si défini', () => {
    const hook = vi.fn();
    PAGE_HOOKS['eleves'] = hook;
    goto('eleves');
    expect(hook).toHaveBeenCalledOnce();
  });

  it('ne plante pas si PAGE_HOOKS[id] est absent', () => {
    expect(() => goto('notes')).not.toThrow();
  });

  it('ne déclenche pas les hooks des autres pages', () => {
    const hookDashboard = vi.fn();
    PAGE_HOOKS['dashboard'] = hookDashboard;
    goto('eleves');
    expect(hookDashboard).not.toHaveBeenCalled();
  });
});

describe('PAGE_HOOKS enregistrement', () => {
  it('accepte et stocke un hook', () => {
    const fn = vi.fn();
    PAGE_HOOKS['notes'] = fn;
    expect(PAGE_HOOKS['notes']).toBe(fn);
  });
});
