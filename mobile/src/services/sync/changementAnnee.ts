// Fin d'année : quand le serveur annonce une autre année scolaire que celle des données locales, les élèves,
// évaluations et notes de l'année précédente n'ont plus lieu d'être sur le téléphone (une classe « 6ème A » de
// l'an dernier ressemblerait à celle de cette année). On repart d'une synchronisation complète.

export type IssueAnnee = 'inchange' | 'purge' | 'differe';

const CLE = 'annee_scolaire_id';

// Données issues du serveur, ENFANTS AVANT PARENTS (clés étrangères : notes -> evaluations, presences -> appels).
// Les opérations en attente (operations_pending) ne sont jamais touchées.
const TABLES_A_VIDER = ['notes', 'presences', 'evaluations', 'appels', 'absences', 'notes_parent', 'moyennes', 'bulletins', 'eleves', 'edt'];

/**
 * Compare l'année annoncée par le serveur à l'année mémorisée.
 *  - 'inchange' : rien à faire (première synchronisation, même année, ou serveur sans information d'année)
 *  - 'purge'    : année différente et rien en attente d'envoi : les données locales ont été vidées, la date de
 *                 dernière synchronisation remise à zéro ; l'appelant doit retélécharger TOUT
 *  - 'differe'  : année différente mais des saisies attendent encore d'être envoyées (en attente ou en erreur) :
 *                 on ne supprime rien, l'année n'est pas mémorisée, on réessaiera à la prochaine synchronisation
 */
export async function traiterAnnee(db: any, anneeServeur: string | null | undefined): Promise<IssueAnnee> {
  if (!anneeServeur) return 'inchange';

  const ligne: any = await db.getFirstAsync('SELECT valeur FROM meta WHERE cle = ?', [CLE]);
  const locale = ligne?.valeur ?? null;

  if (locale === anneeServeur) return 'inchange';
  if (!locale) {                                               // premier passage : on mémorise sans rien vider
    await memoriser(db, anneeServeur);
    return 'inchange';
  }

  const attente: any = await db.getFirstAsync(
    "SELECT COUNT(*) AS n FROM operations_pending WHERE statut IN ('en_attente', 'erreur')");
  if ((attente?.n ?? 0) > 0) return 'differe';

  for (const table of TABLES_A_VIDER) await db.runAsync(`DELETE FROM ${table}`);
  await db.runAsync('UPDATE session SET derniere_sync = NULL');
  await memoriser(db, anneeServeur);
  return 'purge';
}

async function memoriser(db: any, annee: string) {
  await db.runAsync('INSERT INTO meta (cle, valeur) VALUES (?, ?) ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur', [CLE, annee]);
}
