/**
 * Politique de mot de passe — miroir côté navigateur de
 * backend/src/utils/mot-de-passe.js (le serveur reste l'autorité). Sert à
 * afficher l'erreur tout de suite, avant l'appel réseau.
 */
export const MDP_LONGUEUR_MIN = 8;
export const MDP_LONGUEUR_MAX_OCTETS = 72;

/** Retourne le message d'erreur, ou null si le mot de passe est conforme. */
export function verifierMotDePasse(mdp: string): string | null {
  if (!mdp || mdp.length < MDP_LONGUEUR_MIN) {
    return 'Le mot de passe doit contenir au moins ' + MDP_LONGUEUR_MIN + ' caractères.';
  }
  if (new TextEncoder().encode(mdp).length > MDP_LONGUEUR_MAX_OCTETS) {
    return 'Le mot de passe est trop long (72 octets maximum).';
  }
  if (!/[a-z]/.test(mdp) || !/[A-Z]/.test(mdp) || !/[0-9]/.test(mdp)) {
    return 'Le mot de passe doit contenir au moins une majuscule, une minuscule et un chiffre.';
  }
  return null;
}
