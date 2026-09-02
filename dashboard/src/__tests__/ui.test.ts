import { describe, it, expect, beforeEach } from 'vitest';
import { escapeHtml, cn, parCn, init2, toast } from '../ui';

describe('escapeHtml', () => {
  it('échappe les balises HTML', () => {
    expect(escapeHtml('<b>test</b>')).toBe('&lt;b&gt;test&lt;/b&gt;');
  });

  it('échappe les guillemets doubles', () => {
    expect(escapeHtml('"xss"')).toBe('&quot;xss&quot;');
  });

  it('échappe les esperluettes', () => {
    expect(escapeHtml('A & B')).toBe('A &amp; B');
  });

  it('retourne chaîne vide pour null', () => {
    expect(escapeHtml(null)).toBe('');
  });

  it('retourne chaîne vide pour undefined', () => {
    expect(escapeHtml(undefined)).toBe('');
  });

  it('ne modifie pas une chaîne sans caractères spéciaux', () => {
    expect(escapeHtml('Bonjour monde')).toBe('Bonjour monde');
  });

  it('convertit les nombres en chaîne', () => {
    expect(escapeHtml(42 as any)).toBe('42');
  });
});

describe('cn — couleur des notes', () => {
  it('retourne --vert pour >= 14', () => {
    expect(cn(14)).toBe('var(--vert)');
    expect(cn(20)).toBe('var(--vert)');
  });

  it('retourne --orange pour >= 10 et < 14', () => {
    expect(cn(10)).toBe('var(--orange)');
    expect(cn(13.9)).toBe('var(--orange)');
  });

  it('retourne --rouge pour < 10', () => {
    expect(cn(0)).toBe('var(--rouge)');
    expect(cn(9.9)).toBe('var(--rouge)');
  });

  it('retourne --g400 pour null', () => {
    expect(cn(null)).toBe('var(--g400)');
  });

  it('retourne --g400 pour undefined', () => {
    expect(cn(undefined)).toBe('var(--g400)');
  });
});

describe('parCn — couleur notes parent', () => {
  it('retourne --vert pour >= 14', () => {
    expect(parCn(16)).toBe('var(--vert)');
  });

  it('retourne --orange pour 10-14', () => {
    expect(parCn(11)).toBe('var(--orange)');
  });

  it('retourne --rouge pour < 10', () => {
    expect(parCn(5)).toBe('var(--rouge)');
  });

  it('retourne --g500 pour null', () => {
    expect(parCn(null)).toBe('var(--g500)');
  });
});

describe('init2', () => {
  it('extrait les 2 premières initiales', () => {
    expect(init2('Jean Dupont')).toBe('JD');
  });

  it('retourne 1 initiale pour un seul mot', () => {
    expect(init2('Fatou')).toBe('F');
  });

  it('gère les espaces multiples', () => {
    expect(init2('Marie  Claire')).toBe('MC');
  });

  it('retourne chaîne vide pour chaîne vide', () => {
    expect(init2('')).toBe('');
  });

  it('met en majuscules', () => {
    expect(init2('jean dupont')).toBe('JD');
  });
});

describe('toast', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('crée un container toast dans le body', () => {
    toast('Message test', 's');
    expect(document.getElementById('toast-container')).not.toBeNull();
  });

  it('affiche le message dans le toast', () => {
    toast('Mon message', 'i');
    const container = document.getElementById('toast-container');
    expect(container?.textContent).toContain('Mon message');
  });

  it('réutilise le container existant pour plusieurs toasts', () => {
    toast('Premier', 's');
    toast('Deuxième', 'e');
    expect(document.querySelectorAll('#toast-container').length).toBe(1);
    expect(document.getElementById('toast-container')?.children.length).toBe(2);
  });
});
