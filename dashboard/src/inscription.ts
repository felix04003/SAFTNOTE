import { CONFIG } from './config';
import { Api } from './api';
import { Auth } from './auth';

if (Auth.isAuthenticated()) window.location.href = 'index.html';
if (window.innerWidth <= 768) {
  var logoMobile = document.getElementById('logo-mobile');
  if (logoMobile) logoMobile.style.display = 'block';
}

var paysSelectionne = 'SN';

(window as any).selectPays = function(btn: HTMLElement) {
  document.querySelectorAll('.pays-btn').forEach(function(b: any) { b.classList.remove('sel'); });
  btn.classList.add('sel');
  var val = btn.getAttribute('data-pays') || '';
  var autreWrap = document.getElementById('pays-autre-wrap')!;
  if (val === 'autre') {
    autreWrap.classList.add('show');
    paysSelectionne = '';
  } else {
    autreWrap.classList.remove('show');
    paysSelectionne = val;
    (document.getElementById('etab-pays') as HTMLInputElement).value = val;
  }
};

function getPays(): string | null {
  if (paysSelectionne && paysSelectionne !== 'autre') return paysSelectionne;
  var autre = ((document.getElementById('etab-pays-autre') as HTMLInputElement).value || '').trim().toUpperCase();
  return autre || null;
}

(window as any).allerEtape = function(n: number) {
  document.querySelectorAll('.panel').forEach(function(p: any) { p.classList.remove('actif'); });
  document.getElementById('panel' + n)!.classList.add('actif');

  for (var i = 1; i <= 3; i++) {
    var sc = document.getElementById('sc' + i)!;
    var sl = document.getElementById('sl' + i)!;
    sc.classList.remove('actif', 'fait');
    sl.classList.remove('actif', 'fait');
    if (i < n) { sc.classList.add('fait'); sl.classList.add('fait'); sc.textContent = '✓'; }
    else if (i === n) { sc.classList.add('actif'); sl.classList.add('actif'); sc.textContent = String(i); }
    else { sc.textContent = String(i); }
    if (i < 3) {
      var line = document.getElementById('line' + i)!;
      line.classList.toggle('fait', i < n);
    }
  }

  if (n === 3) {
    (document.getElementById('steps-bar') as HTMLElement).style.display = 'none';
    (document.getElementById('link-login') as HTMLElement).style.display = 'none';
    document.getElementById('ins-err')!.classList.remove('show');
  }
};

function showErr(msg: string) {
  var el = document.getElementById('ins-err')!;
  el.textContent = msg;
  el.classList.add('show');
}

(window as any).etape2 = function() {
  document.getElementById('ins-err')!.classList.remove('show');
  var nom  = ((document.getElementById('etab-nom') as HTMLInputElement).value || '').trim();
  var code = ((document.getElementById('etab-code') as HTMLInputElement).value || '').trim().toUpperCase();
  var pays = getPays();

  if (!nom)  return showErr("Le nom de l'établissement est obligatoire.");
  if (!code) return showErr('Le code établissement est obligatoire.');
  if (!/^[A-Z0-9_-]{2,20}$/.test(code)) return showErr('Code invalide : lettres majuscules, chiffres, tirets uniquement (2-20 caractères).');
  if (!pays) return showErr('Veuillez sélectionner ou saisir le pays.');

  (document.getElementById('etab-code') as HTMLInputElement).value = code;
  (window as any).allerEtape(2);
};

(window as any).soumettre = async function() {
  document.getElementById('ins-err')!.classList.remove('show');

  var nom    = ((document.getElementById('etab-nom') as HTMLInputElement).value || '').trim();
  var code   = ((document.getElementById('etab-code') as HTMLInputElement).value || '').trim().toUpperCase();
  var type   = (document.getElementById('etab-type') as HTMLSelectElement).value;
  var pays   = getPays();
  var ville  = ((document.getElementById('etab-ville') as HTMLInputElement).value || '').trim();
  var etabTel   = ((document.getElementById('etab-tel') as HTMLInputElement).value || '').trim();
  var etabEmail = ((document.getElementById('etab-email') as HTMLInputElement).value || '').trim();

  var dirNom    = ((document.getElementById('dir-nom') as HTMLInputElement).value || '').trim();
  var dirPrenom = ((document.getElementById('dir-prenom') as HTMLInputElement).value || '').trim();
  var dirEmail  = ((document.getElementById('dir-email') as HTMLInputElement).value || '').trim();
  var dirTel    = ((document.getElementById('dir-tel') as HTMLInputElement).value || '').trim();
  var mdp       = ((document.getElementById('dir-mdp') as HTMLInputElement).value || '');
  var mdp2      = ((document.getElementById('dir-mdp2') as HTMLInputElement).value || '');

  if (!dirNom)    return showErr('Le nom du directeur est obligatoire.');
  if (!dirPrenom) return showErr('Le prénom du directeur est obligatoire.');
  if (!dirEmail || !dirEmail.includes('@')) return showErr('Email invalide.');
  if (!dirTel)    return showErr('Le numéro de téléphone est obligatoire.');
  if (!/^\+?[0-9]{8,15}$/.test(dirTel.replace(/\s/g,''))) return showErr('Numéro de téléphone invalide (format : +221771234567).');
  if (!mdp || mdp.length < 8) return showErr('Le mot de passe doit contenir au moins 8 caractères.');
  if (mdp !== mdp2) return showErr('Les mots de passe ne correspondent pas.');

  var btn = document.getElementById('btn-inscrire') as HTMLButtonElement;
  btn.disabled = true;
  btn.textContent = 'Création en cours…';

  try {
    var payload: any = {
      etablissement: { nom, code_officiel: code, type, pays },
      directeur: {
        nom: dirNom, prenom: dirPrenom, email: dirEmail,
        telephone: dirTel.replace(/\s/g,''), mot_de_passe: mdp,
      }
    };
    if (ville)     payload.etablissement.ville    = ville;
    if (etabTel)   payload.etablissement.telephone = etabTel.replace(/\s/g,'');
    if (etabEmail) payload.etablissement.email     = etabEmail;

    var res = await fetch(CONFIG.API_BASE + '/inscription', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    var data = await res.json();
    if (!data.succes) throw new Error(data.erreur || 'Erreur lors de la création.');

    (document.getElementById('conf-code') as HTMLElement).textContent  = data.data.connexion.etablissement_code;
    (document.getElementById('conf-email') as HTMLElement).textContent = data.data.connexion.identifiant;
    (document.getElementById('conf-nom') as HTMLElement).textContent   = data.data.etablissement.nom;
    (window as any).allerEtape(3);
  } catch (err: any) {
    showErr(err.message || 'Erreur serveur. Veuillez réessayer.');
    btn.disabled = false;
    btn.textContent = 'Créer mon école';
  }
};
