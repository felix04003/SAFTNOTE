export const TITRES: Record<string, string> = {
  dashboard:   'Tableau de bord',
  eleves:      'Élèves',
  classes:     'Classes',
  enseignants: 'Enseignants',
  notes:       'Notes & Évaluations',
  bulletins:   'Bulletins',
  absences:    'Absences & Présences',
  edt:         'Emploi du temps',
  alertes:     'Alertes',
  parametres:  'Paramètres',
};

export const PAGE_HOOKS: Record<string, () => void> = {};

export function goto(id: string) {
  // Le CSS n'affiche une page que si elle porte .active (.page{display:none} .page.active{display:block}) :
  // basculer seulement style.display laissait toutes les pages masquées
  document.querySelectorAll<HTMLElement>('.page').forEach(p => { p.style.display = 'none'; p.classList.remove('active'); });
  const page = document.getElementById('page-' + id);
  if (page) { page.style.display = ''; page.classList.add('active'); }
  // Le titre de la barre du haut s'appelle #tb-titre dans les trois pages ; #page-titre reste accepté
  const titre = document.getElementById('tb-titre') || document.getElementById('page-titre');
  if (titre) titre.textContent = TITRES[id] || id;
  location.hash = id;
  if (PAGE_HOOKS[id]) PAGE_HOOKS[id]();
}

(window as any).TITRES = TITRES;
(window as any).PAGE_HOOKS = PAGE_HOOKS;
(window as any).goto = goto;
