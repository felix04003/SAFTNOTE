'use strict';

/**
 * CSV pour Excel en français : séparateur « ; », fins de ligne CRLF, BOM UTF-8 (sans lui, les accents sont mal lus),
 * décimales à virgule. Une cellule de texte qui commence par = + - @ (ou tabulation/retour chariot) serait lue comme une
 * formule par Excel : on la préfixe d'une apostrophe (injection de formule). Seul un numéro de téléphone « +221… » reste tel quel.
 */
const SEPARATEUR = ';';
const BOM = '\uFEFF';
const TELEPHONE = /^\+\d{6,15}$/;

function cellule(valeur) {
  if (valeur === null || valeur === undefined) return '';
  if (typeof valeur === 'boolean') return valeur ? 'Oui' : 'Non';
  if (typeof valeur === 'number') return Number.isFinite(valeur) ? String(valeur).replace('.', ',') : '';
  if (valeur instanceof Date) {
    // DATE de PostgreSQL = objet Date à minuit LOCAL : toISOString() reculerait d'un jour dans un fuseau à l'est de UTC
    const p = (n) => String(n).padStart(2, '0');
    return `${valeur.getFullYear()}-${p(valeur.getMonth() + 1)}-${p(valeur.getDate())}`;
  }
  let texte = String(valeur);
  if (/^[=+\-@\t\r]/.test(texte) && !TELEPHONE.test(texte)) texte = `'${texte}`;
  return /[";\r\n]/.test(texte) ? `"${texte.replace(/"/g, '""')}"` : texte;
}

/** colonnes : [{ cle, titre }] ; lignes : objets. Renvoie le texte complet, BOM compris. */
function versCsv(colonnes, lignes) {
  const entete = colonnes.map((c) => cellule(c.titre)).join(SEPARATEUR);
  const corps = lignes.map((l) => colonnes.map((c) => cellule(l[c.cle])).join(SEPARATEUR));
  return BOM + [entete, ...corps].join('\r\n') + '\r\n';
}

module.exports = { versCsv, cellule };
