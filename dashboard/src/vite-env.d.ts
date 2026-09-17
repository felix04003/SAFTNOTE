/// <reference types="vite/client" />

// Déclare les variables d'environnement Vite (VITE_*) utilisées par le
// dashboard, notamment VITE_API_BASE (voir dashboard/.env.example et
// src/config.ts). Ne pas ajouter ici de secrets : tout ce qui est
// préfixé VITE_ est exposé tel quel dans le bundle client.
interface ImportMetaEnv {
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
