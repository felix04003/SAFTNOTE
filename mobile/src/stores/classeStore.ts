// src/stores/classeStore.ts
import { create } from 'zustand';
import { getDB } from '../services/storage/database';

interface ClasseStore {
  classeId:      string | null;
  classeNom:     string | null;
  eleves:        any[];
  chargerEleves: (classeId: string) => Promise<void>;
  setClasse:     (id: string, nom: string) => void;
}

export const useClasseStore = create<ClasseStore>((set, get) => ({
  classeId:  null,
  classeNom: null,
  eleves:    [],

  setClasse: (id, nom) => {
    set({ classeId: id, classeNom: nom });
    get().chargerEleves(id);
  },

  chargerEleves: async (classeId: string) => {
    const db     = getDB();
    const eleves = await db.getAllAsync(
      'SELECT * FROM eleves WHERE classe_id=? OR classe LIKE ? ORDER BY nom, prenom',
      [classeId, '%' + classeId + '%']
    );
    set({ eleves: eleves as any[] });
  },
}));
