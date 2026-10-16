// Politique de mot de passe — miroir de backend/src/utils/mot-de-passe.js
// (le serveur reste l'autorité ; ce contrôle évite seulement un aller-retour réseau).
export const MDP_LONGUEUR_MIN = 8;
const MDP_LONGUEUR_MAX_OCTETS = 72;

function octets(s: string): number {
  let n = 0;
  for (const c of s) {
    const p = c.codePointAt(0)!;
    n += p < 0x80 ? 1 : p < 0x800 ? 2 : p < 0x10000 ? 3 : 4;
  }
  return n;
}

/** Message d'erreur, ou null si le mot de passe est conforme. */
export function verifierMotDePasse(mdp: string): string | null {
  if (!mdp || mdp.length < MDP_LONGUEUR_MIN) return `Au moins ${MDP_LONGUEUR_MIN} caractères.`;
  if (octets(mdp) > MDP_LONGUEUR_MAX_OCTETS) return 'Mot de passe trop long (72 octets maximum).';
  if (!/[a-z]/.test(mdp) || !/[A-Z]/.test(mdp) || !/[0-9]/.test(mdp)) {
    return 'Il faut une majuscule, une minuscule et un chiffre.';
  }
  return null;
}
