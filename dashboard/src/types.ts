// src/types.ts — Interfaces partagées entre tous les modules du dashboard

export interface ApiResponse<T = any> {
  success:  boolean;
  data:     T;
  meta?:    ApiMeta;
  error?:   string;
  message?: string;
}

export interface ApiMeta {
  total:   number;
  page:    number;
  limite:  number;
  pages:   number;
  annee?:  string;
}

export interface User {
  id:                string;
  prenom:            string;
  nom:               string;
  nom_complet?:      string;
  role:              'directeur' | 'censeur' | 'enseignant' | 'parent' | 'admin' | 'super_admin';
  telephone?:        string;
  email?:            string;
  etablissement_id:  string;
  etablissement_nom: string;
}

export interface DashboardStats {
  annee_id?:            string;
  annee_courante:       string | null;
  nb_eleves_actifs:     number;
  nb_classes:           number;
  nb_enseignants:       number;
  absences_aujourd_hui: number;
  incidents_ouverts:    number;
  notifs_en_attente:    number;
  moyenne_generale:     string | null;
}

export interface Eleve {
  id:          string;
  prenom:      string;
  nom:         string;
  matricule?:  string;
  genre?:      'M' | 'F';
  classe?:     string;
  niveau?:     string;
  moyenne?:    number | null;
  nb_absences: number;
  parent_nom?: string;
  telephone?:  string;
}

export interface Enseignant {
  id:          string;
  prenom:      string;
  nom:         string;
  specialite?: string;
  telephone:   string;
  email?:      string;
  statut:      'actif' | 'inactif';
}

export interface Classe {
  id:         string;
  nom_classe: string;
  niveau?:    string;
  effectif?:  number;
  salle?:     string;
  moyenne?:   number | null;
}

export interface Absence {
  id:           string;
  eleve_nom:    string;
  classe?:      string;
  date_cours:   string;
  matiere?:     string;
  statut:       'absent' | 'retard';
  est_justifie: boolean;
  notifie?:     boolean;
}
