// src/stores/authStore.ts
import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import { api } from '../services/api/client';
import { getDB } from '../services/storage/database';

export type Role = 'enseignant' | 'parent' | 'directeur' | 'censeur' | 'admin' | 'super_admin';

export interface Session {
  utilisateur_id:    string;
  etablissement_id:  string;
  nom_complet:       string;
  role:              Role;
  etablissement_nom: string;
}

interface AuthState {
  session:        Session | null;
  token:          string | null;
  chargement:     boolean;
  chargerSession: () => Promise<void>;
  connexionMDP:   (data: { identifiant: string; mot_de_passe: string; etablissement_code: string }) => Promise<void>;
  connexionOTP:   (data: { telephone: string; code: string; etablissement_code: string }) => Promise<void>;
  deconnexion:    () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  session:    null,
  token:      null,
  chargement: true,

  // Charger la session persistée au démarrage
  chargerSession: async () => {
    try {
      const token   = await SecureStore.getItemAsync('jwt_token');
      const session = await SecureStore.getItemAsync('session');
      if (token && session) {
        api.setToken(token);
        set({ token, session: JSON.parse(session) });
      }
    } finally {
      set({ chargement: false });
    }
  },

  // Connexion par mot de passe (enseignants, directeurs)
  connexionMDP: async (data) => {
    const res = await (await import('../services/api/client')).authApi.connexion(data);
    await persisterSession(res, set);
  },

  // Connexion OTP (parents)
  connexionOTP: async (data) => {
    const res = await (await import('../services/api/client')).authApi.validerOTP(data);
    await persisterSession(res, set);
  },

  // Déconnexion
  deconnexion: async () => {
    try {
      await (await import('../services/api/client')).authApi.deconnexion().catch(() => {});
    } finally {
      api.setToken(null);
      await SecureStore.deleteItemAsync('jwt_token');
      await SecureStore.deleteItemAsync('session');
      // Vider la BD locale
      try {
        const db = getDB();
        await db.execAsync(`
          DELETE FROM session;
          DELETE FROM eleves;
          DELETE FROM evaluations;
          DELETE FROM notes;
          DELETE FROM appels;
          DELETE FROM presences;
          DELETE FROM absences;
          DELETE FROM notes_parent;
          DELETE FROM bulletins;
        `);
      } catch {}
      set({ session: null, token: null });
    }
  },
}));

async function persisterSession(res: any, set: any) {
  const { token, utilisateur } = res;
  const session: Session = {
    utilisateur_id:   utilisateur.id,
    etablissement_id: utilisateur.etablissement_id,
    nom_complet:      `${utilisateur.prenom} ${utilisateur.nom}`,
    role:             utilisateur.role || 'enseignant',
    etablissement_nom: utilisateur.etablissement_nom,
  };

  api.setToken(token);
  await SecureStore.setItemAsync('jwt_token', token);
  await SecureStore.setItemAsync('session', JSON.stringify(session));
  set({ token, session });
}
