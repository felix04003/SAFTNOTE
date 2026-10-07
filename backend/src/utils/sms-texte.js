'use strict';

/**
 * Normalisation des textes de SMS pour rester dans l'alphabet SMS de base
 * (GSM 03.38, dit « GSM-7 »).
 *
 * Pourquoi : un SMS tient dans 160 caractères en GSM-7 mais seulement 70 dès
 * qu'UN SEUL caractère est hors de cet alphabet (tiret long « — », « ê »,
 * apostrophe typographique, emoji…) : le message passe en UCS-2 et est facturé
 * 2 à 3 fois plus (jusqu'à 67 caractères par segment au-delà du premier).
 * Les lettres accentuées courantes du français (é è à ù ì ò) font partie de
 * l'alphabet de base ; « ê î ô û ç » (minuscule) n'en font pas.
 */

// Alphabet de base GSM 03.38 (1 septet par caractère)
const BASE = "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
// Table d'extension (2 septets : le caractère d'échappement + le caractère)
const EXT = '^{}\\[~]|€\f';

const SUBSTITUTIONS = {
  '—': '-', '–': '-', '‑': '-',
  '’': "'", '‘': "'",
  '“': '"', '”': '"', '«': '"', '»': '"',
  '…': '...',
  'œ': 'oe', 'Œ': 'OE',
  ' ': ' ', ' ': ' ',
  '°': 'o',
};

const SEGMENT_UNIQUE = 160;      // septets dans un message d'un seul segment
const SEGMENT_CONCATENE = 153;   // septets par segment dans un message multi-segments

/**
 * Convertit un texte en GSM-7 : substitue la ponctuation typographique, retire
 * les accents hors alphabet de base (ê → e, ç → c), supprime le reste (emoji…).
 * Un texte déjà conforme est retourné à l'identique.
 */
function versGsm7(texte) {
  let sortie = '';
  for (const c of String(texte)) {
    if (BASE.includes(c) || EXT.includes(c)) { sortie += c; continue; }
    if (SUBSTITUTIONS[c] !== undefined) { sortie += SUBSTITUTIONS[c]; continue; }
    const sansAccent = c.normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (sansAccent !== c && [...sansAccent].every(x => BASE.includes(x))) sortie += sansAccent;
    // sinon : caractère sans équivalent, supprimé
  }
  return sortie;
}

const septetsDe = (c) => (EXT.includes(c) ? 2 : 1);

/**
 * @returns {{encodage:'GSM-7'|'UCS-2', caracteres:number, segments:number}}
 */
function compterSegments(texte) {
  const caracteres = [...String(texte)];
  const gsm = caracteres.every(c => BASE.includes(c) || EXT.includes(c));
  if (gsm) {
    const septets = caracteres.reduce((n, c) => n + septetsDe(c), 0);
    return {
      encodage: 'GSM-7', caracteres: caracteres.length,
      segments: septets <= SEGMENT_UNIQUE ? 1 : Math.ceil(septets / SEGMENT_CONCATENE),
    };
  }
  const unites = caracteres.reduce((n, c) => n + (c.codePointAt(0) > 0xFFFF ? 2 : 1), 0);
  return {
    encodage: 'UCS-2', caracteres: caracteres.length,
    segments: unites <= 70 ? 1 : Math.ceil(unites / 67),
  };
}

/**
 * Tronque (avec « ... ») un texte GSM-7 pour qu'il ne dépasse pas `maxSegments`
 * segments.
 */
function limiterSegments(texte, maxSegments = 3) {
  if (compterSegments(texte).segments <= maxSegments) return texte;
  const budget = maxSegments * SEGMENT_CONCATENE - 3; // place pour « ... »
  let septets = 0;
  let sortie = '';
  for (const c of texte) {
    if (septets + septetsDe(c) > budget) break;
    septets += septetsDe(c);
    sortie += c;
  }
  return sortie + '...';
}

/** Texte prêt à l'envoi : GSM-7, borné en segments. */
function preparerTexteSms(texte, maxSegments = 3) {
  const final = limiterSegments(versGsm7(texte), maxSegments);
  return { texte: final, ...compterSegments(final) };
}

module.exports = { versGsm7, compterSegments, limiterSegments, preparerTexteSms, SEGMENT_UNIQUE, SEGMENT_CONCATENE };
