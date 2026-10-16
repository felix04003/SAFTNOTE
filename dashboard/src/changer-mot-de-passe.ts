import { Api } from './api';
import { Auth } from './auth';
import { verifierMotDePasse } from './password';

// Page de changement de mot de passe. Ouverte d'office après une connexion
// avec un mot de passe provisoire (doit_changer_mdp), ou à la main pour un
// changement volontaire.

function afficherErreur(message: string) {
  const el = document.getElementById('err-box');
  if (el) { el.textContent = message; el.classList.add('show'); }
}

async function changer(e: Event) {
  e.preventDefault();
  const btn = document.getElementById('btn-changer') as HTMLButtonElement | null;
  document.getElementById('err-box')?.classList.remove('show');

  const actuel   = (document.getElementById('mdp-actuel')  as HTMLInputElement | null)?.value || '';
  const nouveau  = (document.getElementById('mdp-nouveau') as HTMLInputElement | null)?.value || '';
  const confirme = (document.getElementById('mdp-confirm') as HTMLInputElement | null)?.value || '';

  if (!actuel) return afficherErreur('Saisissez votre mot de passe actuel.');
  if (nouveau !== confirme) return afficherErreur('Les mots de passe ne correspondent pas.');
  if (nouveau === actuel) return afficherErreur('Le nouveau mot de passe doit être différent de l’actuel.');
  const erreurRegle = verifierMotDePasse(nouveau);
  if (erreurRegle) return afficherErreur(erreurRegle);

  if (btn) { btn.disabled = true; btn.textContent = 'Enregistrement…'; }
  try {
    await Api.post('/auth/changer-mot-de-passe', {
      mot_de_passe_actuel: actuel,
      nouveau_mot_de_passe: nouveau,
    });
    Auth.majUser({ doit_changer_mdp: false });
    window.location.href = Auth.destination(Auth.getUser());
  } catch (err: any) {
    afficherErreur(err.message || 'Changement impossible.');
    if (btn) { btn.disabled = false; btn.textContent = 'Enregistrer le mot de passe'; }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  if (!Auth.requireAuth()) return;
  if (Auth.getUser()?.doit_changer_mdp) document.getElementById('info-force')?.classList.add('show');
  document.getElementById('form-changer')?.addEventListener('submit', changer);
  document.getElementById('lien-deconnexion')?.addEventListener('click', (ev) => {
    ev.preventDefault();
    Auth.logout();
  });
});
