import { defineConfig } from 'vite';
import { resolve } from 'path';

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
