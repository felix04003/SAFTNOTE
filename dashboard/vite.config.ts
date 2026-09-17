import { defineConfig } from 'vite';
import { resolve } from 'path';

// Lot G (audit 2026-09) : Vite 8 avertit que `configLoader: 'native'`
// (futur défaut) préfèrera `import.meta.dirname` à `__dirname`. On garde
// `__dirname` ici : `import.meta.dirname` demande les types @types/node
// (absents de ce projet, `noEmit` sans Node runtime typé) — changement de
// tooling hors périmètre d'un simple correctif de dépendances. Le warning
// est informatif, pas un échec de build.
export default defineConfig({
  root: '.',
  base: './',
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main:        resolve(__dirname, 'index.html'),
        login:       resolve(__dirname, 'login.html'),
        inscription: resolve(__dirname, 'inscription.html'),
        enseignant:  resolve(__dirname, 'enseignant.html'),
        parent:      resolve(__dirname, 'parent.html'),
        parentLogin: resolve(__dirname, 'parent-login.html'),
        motDePasse:  resolve(__dirname, 'mot-de-passe-oublie.html'),
      },
    },
  },
});
