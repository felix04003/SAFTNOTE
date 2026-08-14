// src/stores/edtStore.ts
// Cache Zustand pour l'emploi du temps enseignant — évite les requêtes SQLite répétées
import { create } from 'zustand';
import { getDB } from '../services/storage/database';

interface CreneauEdt {
  id: string;
  jour_semaine: number;
  heure_debut: string;
  heure_fin: string;
  matiere: string;
  classe: string;
  classe_id: string;
  salle?: string;
}

interface EdtStore {
  edt:        CreneauEdt[];
  chargement: boolean;
  chargerEdt: () => Promise<void>;
  vider:      () => void;
}

export const useEdtStore = create<EdtStore>((set) => ({
  edt:        [],
  chargement: false,

  chargerEdt: async () => {
    set({ chargement: true });
    try {
      const db   = getDB();
      const rows = await db.getAllAsync<CreneauEdt>(
        'SELECT * FROM edt ORDER BY jour_semaine, heure_debut',
      );
      set({ edt: rows });
    } finally {
      set({ chargement: false });
    }
  },

  vider: () => set({ edt: [] }),
}));
