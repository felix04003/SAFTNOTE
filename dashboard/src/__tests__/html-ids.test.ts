import { describe, it, expect } from 'vitest';
import index from '../../index.html?raw';
import enseignant from '../../enseignant.html?raw';
import parent from '../../parent.html?raw';

// Deux éléments de même id : le premier gagne pour getElementById et Playwright. L'agenda a eu un champ « ev-titre »
// masqué par celui du formulaire d'évaluation, sans aucune erreur visible.
describe('identifiants HTML uniques par page', () => {
  for (const [nom, source] of Object.entries({ 'index.html': index, 'enseignant.html': enseignant, 'parent.html': parent })) {
    it(nom, () => {
      const html = source.replace(/<!--[\s\S]*?-->/g, '');
      const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
      const doublons = ids.filter((id, i) => ids.indexOf(id) !== i);
      expect([...new Set(doublons)]).toEqual([]);
    });
  }
});

// Un bouton qui n'affiche qu'une bulle « fait » sans rien faire trompe le directeur (« Tout marquer lu », « Tester SMS »).
describe('aucun bouton factice', () => {
  for (const [nom, source] of Object.entries({ 'index.html': index, 'enseignant.html': enseignant, 'parent.html': parent })) {
    it(nom, () => {
      const html = source.replace(/<!--[\s\S]*?-->/g, '');
      expect(html.match(/onclick="toast\(/g) || []).toEqual([]);
    });
  }
});
