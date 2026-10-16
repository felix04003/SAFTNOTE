import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Deux éléments de même id : le premier gagne pour getElementById et Playwright. L'agenda a eu un champ « ev-titre »
// masqué par celui du formulaire d'évaluation, sans aucune erreur visible.
describe('identifiants HTML uniques par page', () => {
  for (const page of ['index.html', 'enseignant.html', 'parent.html']) {
    it(page, () => {
      const html = readFileSync(resolve(__dirname, '../../', page), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
      const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
      const doublons = ids.filter((id, i) => ids.indexOf(id) !== i);
      expect([...new Set(doublons)]).toEqual([]);
    });
  }
});
