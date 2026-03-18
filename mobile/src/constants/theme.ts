// src/constants/theme.ts
// Alias de compatibilité pour les layouts (COULEURS / TYPOGRAPHIE)
// La source de vérité reste src/utils/theme.ts

export const COULEURS = {
  vert:       '#1A4731',  // Colors.primary
  vertClair:  '#2C6E49',  // Colors.primaryLight
  vertFond:   '#EAF4EE',  // Colors.primaryBg
  orange:     '#E07B39',  // Colors.accent
  blanc:      '#FFFFFF',  // Colors.white
  fond:       '#F5F5F0',  // Colors.background
  grisClaire: '#E5E7EB',  // Colors.gray200
  grisMoyen:  '#9CA3AF',  // Colors.gray400
  grisFonce:  '#6B7280',  // Colors.gray500
  noir:       '#111827',  // Colors.gray900
  danger:     '#C0392B',  // Colors.danger
  succes:     '#27AE60',  // Colors.success
  avertissement: '#F39C12', // Colors.warning
} as const;

export const TYPOGRAPHIE = {
  xxs:  10,
  xs:   11,
  sm:   13,
  base: 15,
  md:   17,
  lg:   20,
  xl:   24,
} as const;
