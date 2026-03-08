// src/utils/theme.ts
// Charte graphique du projet — palette Afrique de l'Ouest

export const Colors = {
  // Vert principal (forêt, nature, confiance)
  primary:      '#1A4731',
  primaryDark:  '#0F2A1D',
  primaryLight: '#2C6E49',
  primaryBg:    '#EAF4EE',

  // Accent orange (Afrique, dynamisme, alertes)
  accent:       '#E07B39',
  accentLight:  '#FDF2E9',

  // Bleu notes / académique
  blue:         '#1A5276',
  blueLight:    '#EBF5FB',

  // Rouge absence
  danger:       '#C0392B',
  dangerLight:  '#FDEDEC',

  // Statuts
  success:      '#27AE60',
  successLight: '#EAFAF1',
  warning:      '#F39C12',
  warningLight: '#FEF9E7',
  info:         '#2E86C1',
  infoLight:    '#EBF5FB',

  // Neutres
  white:        '#FFFFFF',
  gray50:       '#F9FAFB',
  gray100:      '#F3F4F6',
  gray200:      '#E5E7EB',
  gray300:      '#D1D5DB',
  gray400:      '#9CA3AF',
  gray500:      '#6B7280',
  gray600:      '#4B5563',
  gray700:      '#374151',
  gray900:      '#111827',
  black:        '#1A1A1A',

  // Matières (identité visuelle par discipline)
  maths:        '#1A5276',
  physique:     '#7D3C98',
  svt:          '#1E8449',
  francais:     '#B7950B',
  histoire:     '#935116',
  anglais:      '#1A5276',
  philosophie:  '#6C3483',
  eps:          '#1A6B3A',
  techno:       '#1B4F72',

  // Fond app
  background:   '#F5F5F0',
  surface:      '#FFFFFF',
  border:       '#E5E7EB',
} as const;

export const Spacing = {
  xs:   4,
  sm:   8,
  md:  16,
  lg:  24,
  xl:  32,
  xxl: 48,
} as const;

export const Radius = {
  sm:  6,
  md: 12,
  lg: 20,
  xl: 32,
  full: 9999,
} as const;

export const Typography = {
  // Tailles
  xs:   11,
  sm:   13,
  base: 15,
  md:   17,
  lg:   20,
  xl:   24,
  xxl:  30,
  xxxl: 36,
  // Poids
  regular: '400' as const,
  medium:  '500' as const,
  semibold:'600' as const,
  bold:    '700' as const,
  black_w: '900' as const,
} as const;

export const Shadow = {
  sm: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 2,
  },
  md: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.10,
    shadowRadius: 8,
    elevation: 4,
  },
  lg: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 8,
  },
} as const;

// Couleur par note (sur 20)
export function couleurNote(note: number | null): string {
  if (note === null) return Colors.gray400;
  if (note >= 16) return Colors.success;
  if (note >= 14) return Colors.primary;
  if (note >= 10) return Colors.accent;
  if (note >=  8) return Colors.warning;
  return Colors.danger;
}

// Couleur par statut de présence
export const couleurPresence: Record<string, string> = {
  present:     Colors.success,
  absent:      Colors.danger,
  retard:      Colors.warning,
  sorti_avant: Colors.accent,
  dispense:    Colors.info,
  non_saisi:   Colors.gray300,
};
