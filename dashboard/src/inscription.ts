import { CONFIG } from './config';
import { Api } from './api';
import { Auth } from './auth';

if (Auth.isAuthenticated()) window.location.href = 'index.html';
if (window.innerWidth <= 768) {
  const logoMobile = document.getElementById('logo-mobile');
  if (logoMobile) logoMobile.style.display = 'block';
}

let paysSelectionne = 'SN';

function selectPays(btn: HTMLElement) {
  document.querySelectorAll('.pays-btn').forEach(function(b: any) { b.classList.remove('sel'); });
  btn.classList.add('sel');
  const val = btn.getAttribute('data-pays') || '';
  const autreWrap = document.getElementById('pays-autre-wrap') as HTMLElement | null;
  if (val === 'autre') {
    autreWrap?.classList.add('show');
    paysSelectionne = '';
  } else {
    autreWrap?.classList.remove('show');
    paysSelectionne = val;
    const etabPays = document.getElementById('etab-pays') as HTMLInputElement | null;
    if (etabPays) etabPays.value = val;
  }
}

function getPays(): string | null {
  if (paysSelectionne && paysSelectionne !== 'autre') return paysSelectionne;
  const autre = ((document.getElementById('etab-pays-autre') as HTMLInputElement | null)?.value || '').trim().toUpperCase();
  return autre || null;
}

function allerEtape(n: number) {
  document.querySelectorAll('.panel').forEach(function(p: any) { p.classList.remove('actif'); });
  document.getElementById('panel' + n)?.classList.add('actif');

  for (let i = 1; i <= 3; i++) {
    const sc = document.getElementById('sc' + i) as HTMLElement | null;
    const sl = document.getElementById('sl' + i) as HTMLElement | null;
    sc?.classList.remove('actif', 'fait');
    sl?.classList.remove('actif', 'fait');
    if (i < n) { sc?.classList.add('fait'); sl?.classList.add('fait'); if (sc) sc.textContent = '\u2713'; }
    else if (i === n) { sc?.classList.add('actif'); sl?.classList.add('actif'); if (sc) sc.textContent = String(i); }
    else { if (sc) sc.textContent = String(i); }
    if (i < 3) {
      const line = document.getElementById('line' + i) as HTMLElement | null;
      line?.classList.toggle('fait', i < n);
    }
  }

  if (n === 3) {
    (document.getElementById('steps-bar') as HTMLElement | null)?.style && ((document.getElementById('steps-bar') as HTMLElement).style.display = 'none');
    (document.getElementById('link-login') as HTMLElement | null)?.style && ((document.getElementById('link-login') as HTMLElement).style.display = 'none');
    document.getElementById('ins-err')?.classList.remove('show');
  }
}

function showErr(msg: string) {
  const el = document.getElementById('ins-err') as HTMLElement | null;
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
}

function etape2() {
  document.getElementById('ins-err')?.classList.remove('show');
  const nom  = ((document.getElementById('etab-nom') as HTMLInputElement | null)?.value || '').trim();
  const code = ((document.getElementById('etab-code') as HTMLInputElement | null)?.value || '').trim().toUpperCase();
  const pays = getPays();

  if (!nom)  return showErr("Le nom de l'\u00e9tablissement est obligatoire.");
  if (!code) return showErr('Le code \u00e9tablissement est obligatoire.');
  if (!/^[A-Z0-9_-]{2,20}$/.test(code)) return showErr('Code invalide : lettres majuscules, chiffres, tirets uniquement (2-20 caract\u00e8res).');
  if (!pays) return showErr('Veuillez s\u00e9lectionner ou saisir le pays.');

  const etabCode = document.getElementById('etab-code') as HTMLInputElement | null;
  if (etabCode) etabCode.value = code;
  allerEtape(2);
}

async function soumettre() {
  document.getElementById('ins-err')?.classList.remove('show');

  const nom    = ((document.getElementById('etab-nom') as HTMLInputElement | null)?.value || '').trim();
  const code   = ((document.getElementById('etab-code') as HTMLInputElement | null)?.value || '').trim().toUpperCase();
  const type   = (document.getElementById('etab-type') as HTMLSelectElement | null)?.value || '';
  const pays   = getPays();
  const ville  = ((document.getElementById('etab-ville') as HTMLInputElement | null)?.value || '').trim();
  const etabTel   = ((document.getElementById('etab-tel') as HTMLInputElement | null)?.value || '').trim();
  const etabEmail = ((document.getElementById('etab-email') as HTMLInputElement | null)?.value || '').trim();

  const dirNom    = ((document.getElementById('dir-nom') as HTMLInputElement | null)?.value || '').trim();
  const dirPrenom = ((document.getElementById('dir-prenom') as HTMLInputElement | null)?.value || '').trim();
  const dirEmail  = ((document.getElementById('dir-email') as HTMLInputElement | null)?.value || '').trim();
  const dirTel    = ((document.getElementById('dir-tel') as HTMLInputElement | null)?.value || '').trim();
  const mdp       = ((document.getElementById('dir-mdp') as HTMLInputElement | null)?.value || '');
  const mdp2      = ((document.getElementById('dir-mdp2') as HTMLInputElement | null)?.value || '');

  if (!dirNom)    return showErr('Le nom du directeur est obligatoire.');
  if (!dirPrenom) return showErr('Le prénom du directeur est obligatoire.');
  if (!dirEmail || !dirEmail.includes('@')) return showErr('Email invalide.');
  if (!dirTel)    return showErr('Le numéro de téléphone est obligatoire.');
  if (!/^\+?[0-9]{8,15}$/.test(dirTel.replace(/\s/g,''))) return showErr('Numéro de téléphone invalide (format : +221771234567).');
  if (!mdp || mdp.length < 8) return showErr('Le mot de passe doit contenir au moins 8 caractères.');
  if (mdp !== mdp2) return showErr('Les mots de passe ne correspondent pas.');

  const btn = document.getElementById('btn-inscrire') as HTMLButtonElement | null;
  if (btn) { btn.disabled = true; btn.textContent = 'Cr\u00e9ation en cours\u2026'; }

  try {
    const payload: any = {
      etablissement: { nom, code_officiel: code, type, pays },
      directeur: {
        nom: dirNom, prenom: dirPrenom, email: dirEmail,
        telephone: dirTel.replace(/\s/g,''), mot_de_passe: mdp,
      }
    };
    if (ville)     payload.etablissement.ville    = ville;
    if (etabTel)   payload.etablissement.telephone = etabTel.replace(/\s/g,'');
    if (etabEmail) payload.etablissement.email     = etabEmail;

    const res = await fetch(CONFIG.API_BASE + '/inscription', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!data.succes) throw new Error(data.erreur || 'Erreur lors de la cr\u00e9ation.');

    const confCode = document.getElementById('conf-code') as HTMLElement | null;
    const confEmail = document.getElementById('conf-email') as HTMLElement | null;
    const confNom = document.getElementById('conf-nom') as HTMLElement | null;
    if (confCode) confCode.textContent   = data.data.connexion.etablissement_code;
    if (confEmail) confEmail.textContent = data.data.connexion.identifiant;
    if (confNom) confNom.textContent     = data.data.etablissement.nom;
    allerEtape(3);
  } catch (err: any) {
    showErr(err.message || 'Erreur serveur. Veuillez r\u00e9essayer.');
    if (btn) { btn.disabled = false; btn.textContent = 'Cr\u00e9er mon \u00e9cole'; }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.pays-btn').forEach((btn) => {
    btn.addEventListener('click', () => selectPays(btn as HTMLElement));
  });
  document.getElementById('btn-etape2')?.addEventListener('click', etape2);
  document.getElementById('btn-retour-etape1')?.addEventListener('click', () => allerEtape(1));
  document.getElementById('btn-inscrire')?.addEventListener('click', soumettre);
});
