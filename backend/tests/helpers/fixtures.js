'use strict';

const { IDS } = require('./mockKnex');

// ── Données de test réutilisables ──────────────────────────────────

const enseignantProfil = {
  id: IDS.enseignant,
  utilisateur_id: IDS.utilisateur,
  matricule_fonct: 'MAT-001',
  specialite: 'Mathématiques',
  type_contrat: 'titulaire',
};

const anneeCourante = {
  id: IDS.annee,
  libelle: '2024-2025',
  est_courante: true,
  etablissement_id: IDS.etablissement,
};

const classeTermS1 = {
  affectation_id: IDS.affectation,
  classe_id: IDS.classe,
  classe: 'Term S1',
  niveau: 'Terminale',
  cycle: 'secondaire',
  matiere_id: IDS.matiere,
  matiere: 'Mathématiques',
  matiere_court: 'Maths',
  matiere_code: 'MATH',
  est_titulaire: true,
  effectif_max: 45,
  salle_principale: 'Salle A3',
};

const creneauEdt = {
  creneau_id: 'edt-001',
  jour_semaine: 1,
  plage_numero: 1,
  plage_libelle: '8h-9h',
  heure_debut: '08:00:00',
  heure_fin: '09:00:00',
  est_pause: false,
  classe: 'Term S1',
  classe_id: IDS.classe,
  matiere: 'Mathématiques',
  matiere_court: 'Maths',
  matiere_code: 'MATH',
  salle: 'Salle A3',
  affectation_id: IDS.affectation,
};

const enfant = {
  eleve_utilisateur_id: IDS.eleve,
  nom: 'Traoré',
  prenom: 'Aminata',
  date_naissance: '2008-03-15',
  genre: 'F',
  photo_url: null,
  matricule: 'ELV-001',
  lien: 'mere',
  est_contact_principal: true,
  peut_voir_notes: true,
  peut_voir_absences: true,
  peut_voir_bulletins: true,
  peut_voir_discipline: true,
  inscription_id: IDS.inscription,
  classe: 'Term S1',
  niveau: 'Terminale',
  annee_scolaire: '2024-2025',
};

const lienParentEnfant = {
  id: 'pe-001',
  parent_id: IDS.utilisateur,
  eleve_id: IDS.eleve,
  eleve_id_pk: IDS.eleve,
  eleve_utilisateur_id: IDS.eleve,
  lien: 'mere',
  est_contact_principal: true,
  peut_voir_notes: true,
  peut_voir_absences: true,
  peut_voir_bulletins: true,
  peut_voir_discipline: true,
};

const inscriptionCourante = {
  inscription_id: IDS.inscription,
  classe_id: IDS.classe,
  classe: 'Term S1',
  niveau: 'Terminale',
  annee_id: IDS.annee,
  annee_libelle: '2024-2025',
};

const noteEleve = {
  id: 'note-001',
  valeur: 15.5,
  est_absent: false,
  appreciation: 'Bon travail',
  type: 'devoir',
  numero: 1,
  date_evaluation: '2025-01-15',
  note_max: 20,
  moyenne_classe: 12.3,
  note_min_classe: 5,
  note_max_classe: 18,
  matiere: 'Mathématiques',
  couleur_affichage: '#4A90D9',
  trimestre: 1,
  periode: 'Trimestre 1',
};

const moyenneMatiere = {
  matiere: 'Mathématiques',
  coefficient: 5,
  moyenne: 14.25,
  rang: 3,
  rang_sur: 35,
  appreciation_enseignant: 'Bon niveau',
};

const bulletin = {
  id: 'bul-001',
  inscription_id: IDS.inscription,
  periode_id: IDS.periode,
  trimestre: 1,
  periode: 'Trimestre 1',
  moyenne_generale: 14.5,
  rang: 3,
  rang_sur: 35,
  mention: 'Bien',
  decision_conseil: null,
  appreciation_conseil: 'Bon ensemble. Continue ainsi.',
  nb_absences_justifiees: 2,
  nb_absences_injustifiees: 1,
  nb_retards: 3,
  bulletin_url: '/storage/bulletins/bul-001.pdf',
  bulletin_genere: true,
  bulletin_genere_at: '2025-01-20T10:00:00Z',
  valide_at: '2025-01-21T14:00:00Z',
  total_points: 290,
  total_coefficients: 20,
  nom: 'Traoré',
  prenom: 'Aminata',
  date_naissance: '2008-03-15',
  genre: 'F',
  matricule: 'ELV-001',
  classe: 'Term S1',
  niveau: 'Terminale',
  annee_scolaire: '2024-2025',
  note_conduite: 18,
};

const sanction = {
  id: 'san-001',
  type: 'avertissement_oral',
  motif: 'Bavardage en classe',
  date_prononcee: '2025-01-10',
  date_debut: null,
  date_fin: null,
  nb_jours: null,
  inscription_id: IDS.inscription,
  eleve_id: IDS.eleve,
  eleve_nom: 'Traoré',
  eleve_prenom: 'Aminata',
  matricule: 'ELV-001',
  classe: 'Term S1',
  prononcee_par: 'Moussa Diallo',
  notif_parent_envoyee: false,
  created_at: '2025-01-10T08:30:00Z',
};

const evenement = {
  id: 'evt-001',
  titre: 'Réunion parents-enseignants T1',
  description: 'Remise des bulletins du premier trimestre',
  type: 'reunion_parents',
  date_debut: '2025-01-25',
  date_fin: '2025-01-25',
  heure_debut: '14:00',
  heure_fin: '17:00',
  lieu: 'Salle des fêtes',
  concerne_tout_etablissement: true,
  classes_concernees: null,
  niveaux_concernes: null,
  necessite_autorisation: false,
  date_limite_autorisation: null,
  cout_participation: null,
  devise_cout: 'XOF',
  notif_programmee: false,
  notif_envoyee_at: null,
  created_at: '2025-01-10T08:00:00Z',
};

const auditEntry = {
  id: 'aud-001',
  action: 'notes.saisir',
  resultat: 'succes',
  table_cible: 'notes',
  enregistrement_id: 'note-001',
  utilisateur_id: IDS.utilisateur,
  utilisateur: 'Moussa Diallo',
  details: JSON.stringify({ matiere: 'Mathématiques', nb_notes: 32 }),
  ip_address: '192.168.1.10',
  valeur_avant: null,
  valeur_apres: null,
  created_at: '2025-01-15T09:00:00Z',
};

const sessionActive = {
  id: IDS.session,
  utilisateur_id: IDS.utilisateur,
  utilisateur: 'Moussa Diallo',
  ip_address: '192.168.1.10',
  user_agent: 'EcoleManager-Mobile/1.0',
  appareil: 'mobile',
  canal_connexion: 'mobile',
  derniere_activite: '2025-01-15T09:30:00Z',
  created_at: '2025-01-15T08:00:00Z',
  expire_at: '2025-01-15T16:00:00Z',
  revoquee: false,
};

module.exports = {
  enseignantProfil,
  anneeCourante,
  classeTermS1,
  creneauEdt,
  enfant,
  lienParentEnfant,
  inscriptionCourante,
  noteEleve,
  moyenneMatiere,
  bulletin,
  sanction,
  evenement,
  auditEntry,
  sessionActive,
};
