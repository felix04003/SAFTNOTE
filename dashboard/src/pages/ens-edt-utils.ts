// Utilitaires date — pas de toISOString() : décalage UTC possible sur les fuseaux UTC+X

export function _lundiDeSemaine(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const jour = d.getDay(); // 0=dim, 1=lun, 6=sam
  const diff = (jour === 0) ? -6 : 1 - jour;
  d.setDate(d.getDate() + diff);
  return d;
}

export function _dateISO(d: Date): string {
  const mm = ('0' + (d.getMonth() + 1)).slice(-2);
  const jj = ('0' + d.getDate()).slice(-2);
  return d.getFullYear() + '-' + mm + '-' + jj;
}

export function _addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

export function _labelSemaine(lundi: Date): string {
  const ven = _addDays(lundi, 4);
  const mois = ['jan', 'f\u00e9v', 'mars', 'avr', 'mai', 'juin', 'juil', 'ao\u00fbt', 'sep', 'oct', 'nov', 'd\u00e9c'];
  return 'Lun ' + lundi.getDate() + ' ' + mois[lundi.getMonth()] +
    ' \u2013 Ven ' + ven.getDate() + ' ' + mois[ven.getMonth()] +
    ' ' + ven.getFullYear();
}
