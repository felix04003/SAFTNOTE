export const PAR_TITRES: Record<string, string> = {
  'par-dashboard': 'Tableau de bord',
  'par-notes':     'Mes notes',
  'par-absences':  'Absences',
  'par-bulletins': 'Bulletins',
};

export const PAR_HOOKS: Record<string, () => void> = {};

export function goto(id: string) {
  // Le CSS n'affiche une page que si elle porte .active (.page{display:none} .page.active{display:block}) :
  // basculer seulement style.display laissait toutes les pages masquées
  document.querySelectorAll<HTMLElement>('.page').forEach(p => { p.style.display = 'none'; p.classList.remove('active'); });
  const page = document.getElementById('page-' + id);
  if (page) { page.style.display = ''; page.classList.add('active'); }
  // Le titre de la barre du haut s'appelle #tb-titre dans les trois pages ; #page-titre reste accepté
  const titre = document.getElementById('tb-titre') || document.getElementById('page-titre');
  if (titre) titre.textContent = PAR_TITRES[id] || id;
  location.hash = id;
  if (PAR_HOOKS[id]) PAR_HOOKS[id]();
}

(window as any).PAR_TITRES = PAR_TITRES;
(window as any).PAR_HOOKS = PAR_HOOKS;
(window as any).goto = goto;
