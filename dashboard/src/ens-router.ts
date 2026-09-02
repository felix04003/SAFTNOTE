export const ENS_TITRES: Record<string, string> = {
  'ens-dashboard':  'Mon tableau de bord',
  'ens-classes':    'Mes classes',
  'ens-notes':      'Notes & Évaluations',
  'ens-edt':        "Mon emploi du temps",
  'ens-appel':      "Faire l'appel",
  'ens-discipline': 'Discipline',
};

export const PAGE_HOOKS: Record<string, () => void> = {};

export function goto(id: string) {
  document.querySelectorAll<HTMLElement>('.page').forEach(p => (p.style.display = 'none'));
  const page = document.getElementById('page-' + id);
  if (page) page.style.display = '';
  const titre = document.getElementById('page-titre');
  if (titre) titre.textContent = ENS_TITRES[id] || id;
  location.hash = id;
  if (PAGE_HOOKS[id]) PAGE_HOOKS[id]();
}

(window as any).ENS_TITRES = ENS_TITRES;
(window as any).PAGE_HOOKS = PAGE_HOOKS;
(window as any).goto = goto;
