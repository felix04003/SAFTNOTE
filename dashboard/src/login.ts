import { CONFIG } from './config';
import { Auth } from './auth';
import { toast } from './ui';

// Redirect if already logged in
if (Auth.isAuthenticated()) {
  window.location.href = 'index.html';
}

function onglet(id: string) {
  document.querySelectorAll('.login-tab').forEach(function(t: Element, i: number) {
    t.classList.toggle('actif', (i === 0 && id === 'connexion') || (i === 1 && id === 'inscription'));
  });
  const panConn = document.getElementById('panel-connexion');
  const panIns  = document.getElementById('panel-inscription');
  if (panConn) panConn.classList.toggle('actif', id === 'connexion');
  if (panIns)  panIns.classList.toggle('actif', id === 'inscription');
}

async function handleLogin(e: Event) {
  e.preventDefault();
  const btn   = document.getElementById('login-btn') as HTMLButtonElement | null;
  const errEl = document.getElementById('login-err') as HTMLElement | null;
  const identifiant        = (document.getElementById('login-id')   as HTMLInputElement).value.trim();
  const mot_de_passe       = (document.getElementById('login-pwd')  as HTMLInputElement).value;
  const etablissement_code = (document.getElementById('login-etab') as HTMLInputElement).value.trim();

  if (btn) { btn.disabled = true; btn.textContent = 'Connexion en cours…'; }
  if (errEl) errEl.classList.remove('show');

  try {
    await Auth.login(identifiant, mot_de_passe, etablissement_code);
  } catch (err: any) {
    if (errEl) { errEl.textContent = err.message || 'Identifiants incorrects'; errEl.classList.add('show'); }
    if (btn) { btn.disabled = false; btn.textContent = 'Se connecter'; }
  }
}

async function handleInscription() {
  const errEl = document.getElementById('inscription-err') as HTMLElement | null;
  const btn   = document.getElementById('ins-btn') as HTMLButtonElement | null;
  if (errEl) errEl.classList.remove('show');

  const nom    = (document.getElementById('ins-nom')     as HTMLInputElement).value.trim();
  const type   = (document.getElementById('ins-type')    as HTMLSelectElement).value;
  const pays   = (document.getElementById('ins-pays')    as HTMLSelectElement).value;
  const ville  = (document.getElementById('ins-ville')   as HTMLInputElement).value.trim();
  const prenom = (document.getElementById('ins-prenom')  as HTMLInputElement).value.trim();
  const nomDir = (document.getElementById('ins-nom-dir') as HTMLInputElement).value.trim();
  const tel    = (document.getElementById('ins-tel')     as HTMLInputElement).value.trim();
  const email  = (document.getElementById('ins-email')   as HTMLInputElement).value.trim();
  const mdp    = (document.getElementById('ins-mdp')     as HTMLInputElement).value;

  if (!nom || !ville || !prenom || !nomDir || !tel || !mdp) {
    if (errEl) { errEl.textContent = 'Veuillez remplir tous les champs obligatoires (*)'; errEl.classList.add('show'); }
    return;
  }
  if (mdp.length < 6) {
    if (errEl) { errEl.textContent = 'Le mot de passe doit contenir au moins 6 caractères'; errEl.classList.add('show'); }
    return;
  }

  if (btn) { btn.disabled = true; btn.textContent = 'Création en cours…'; }

  try {
    const res = await fetch(CONFIG.API_BASE + '/etablissements/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nom, type, pays, ville,
        directeur_prenom: prenom,
        directeur_nom: nomDir,
        directeur_telephone: tel.replace(/\s/g, ''),
        directeur_email: email || undefined,
        directeur_mdp: mdp,
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.succes) throw new Error(data.erreur || 'Erreur lors de la création');

    const code = data.data.etablissement.code_officiel;
    (document.getElementById('code-officiel') as HTMLElement).textContent = code;
    (document.getElementById('inscription-form-wrap') as HTMLElement).style.display = 'none';
    (document.getElementById('inscription-success') as HTMLElement).style.display = 'block';
    (document.getElementById('login-id') as HTMLInputElement).value = tel;
    (document.getElementById('login-etab') as HTMLInputElement).value = code;
  } catch (err: any) {
    if (errEl) { errEl.textContent = err.message || 'Création échouée'; errEl.classList.add('show'); }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Créer mon établissement'; }
  }
}

function copierCode() {
  const code = (document.getElementById('code-officiel') as HTMLElement).textContent || '';
  navigator.clipboard.writeText(code).then(function() {
    toast('Code copié ✓', 's');
  }).catch(function() {
    toast('Code : ' + code, '');
  });
}

function allerConnexion() {
  (document.getElementById('inscription-form-wrap') as HTMLElement).style.display = 'block';
  (document.getElementById('inscription-success') as HTMLElement).style.display = 'none';
  onglet('connexion');
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('login-form')?.addEventListener('submit', handleLogin);
  document.getElementById('btn-tab-connexion')?.addEventListener('click', () => onglet('connexion'));
  document.getElementById('btn-tab-inscription')?.addEventListener('click', () => onglet('inscription'));
  document.getElementById('lnk-go-inscription')?.addEventListener('click', (e) => { e.preventDefault(); onglet('inscription'); });
  document.getElementById('lnk-go-connexion')?.addEventListener('click', (e) => { e.preventDefault(); onglet('connexion'); });
  document.getElementById('ins-btn')?.addEventListener('click', handleInscription);
  document.getElementById('btn-copier-code')?.addEventListener('click', copierCode);
  document.getElementById('btn-aller-connexion')?.addEventListener('click', allerConnexion);
});
