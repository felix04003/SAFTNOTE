import { CONFIG } from './config';
import { Api } from './api';
import { Auth } from './auth';
import { toast } from './ui';

// Redirect if already logged in
if (Auth.isAuthenticated()) {
  window.location.href = 'index.html';
}

(window as any).onglet = function(id: string) {
  document.querySelectorAll('.login-tab').forEach(function(t: any, i: number) {
    t.classList.toggle('actif', (i === 0 && id === 'connexion') || (i === 1 && id === 'inscription'));
  });
  document.getElementById('panel-connexion')!.classList.toggle('actif', id === 'connexion');
  document.getElementById('panel-inscription')!.classList.toggle('actif', id === 'inscription');
};

(window as any).handleLogin = async function(e: Event) {
  e.preventDefault();
  var btn    = document.getElementById('login-btn') as HTMLButtonElement;
  var errEl  = document.getElementById('login-err')!;
  var identifiant        = (document.getElementById('login-id') as HTMLInputElement).value.trim();
  var mot_de_passe       = (document.getElementById('login-pwd') as HTMLInputElement).value;
  var etablissement_code = (document.getElementById('login-etab') as HTMLInputElement).value.trim();

  btn.disabled = true;
  btn.textContent = 'Connexion en cours…';
  errEl.classList.remove('show');

  try {
    await Auth.login(identifiant, mot_de_passe, etablissement_code);
  } catch (err: any) {
    errEl.textContent = err.message || 'Identifiants incorrects';
    errEl.classList.add('show');
    btn.disabled = false;
    btn.textContent = 'Se connecter';
  }
};

(window as any).handleInscription = async function() {
  var errEl  = document.getElementById('inscription-err')!;
  var btn    = document.getElementById('ins-btn') as HTMLButtonElement;
  errEl.classList.remove('show');

  var nom    = (document.getElementById('ins-nom') as HTMLInputElement).value.trim();
  var type   = (document.getElementById('ins-type') as HTMLSelectElement).value;
  var pays   = (document.getElementById('ins-pays') as HTMLSelectElement).value;
  var ville  = (document.getElementById('ins-ville') as HTMLInputElement).value.trim();
  var prenom = (document.getElementById('ins-prenom') as HTMLInputElement).value.trim();
  var nomDir = (document.getElementById('ins-nom-dir') as HTMLInputElement).value.trim();
  var tel    = (document.getElementById('ins-tel') as HTMLInputElement).value.trim();
  var email  = (document.getElementById('ins-email') as HTMLInputElement).value.trim();
  var mdp    = (document.getElementById('ins-mdp') as HTMLInputElement).value;

  if (!nom || !ville || !prenom || !nomDir || !tel || !mdp) {
    errEl.textContent = 'Veuillez remplir tous les champs obligatoires (*)';
    errEl.classList.add('show');
    return;
  }
  if (mdp.length < 6) {
    errEl.textContent = 'Le mot de passe doit contenir au moins 6 caractères';
    errEl.classList.add('show');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Création en cours…';

  try {
    var res = await fetch(CONFIG.API_BASE + '/etablissements/register', {
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
    var data = await res.json();
    if (!res.ok || !data.succes) throw new Error(data.erreur || 'Erreur lors de la création');

    var code = data.data.etablissement.code_officiel;
    (document.getElementById('code-officiel') as HTMLElement).textContent = code;
    (document.getElementById('inscription-form-wrap') as HTMLElement).style.display = 'none';
    (document.getElementById('inscription-success') as HTMLElement).style.display = 'block';
    (document.getElementById('login-id') as HTMLInputElement).value = tel;
    (document.getElementById('login-etab') as HTMLInputElement).value = code;
  } catch (err: any) {
    errEl.textContent = err.message || 'Création échouée';
    errEl.classList.add('show');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Créer mon établissement';
  }
};

(window as any).copierCode = function() {
  var code = (document.getElementById('code-officiel') as HTMLElement).textContent || '';
  navigator.clipboard.writeText(code).then(function() {
    toast('Code copié ✓', 's');
  }).catch(function() {
    toast('Code : ' + code, '');
  });
};

(window as any).allerConnexion = function() {
  (document.getElementById('inscription-form-wrap') as HTMLElement).style.display = 'block';
  (document.getElementById('inscription-success') as HTMLElement).style.display = 'none';
  (window as any).onglet('connexion');
};
