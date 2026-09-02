import { CONFIG } from './config';
import { Api } from './api';

let _telephone = '';
let _etabCode = '';
let _resendTimer: any = null;

async function demanderOTP() {
  const tel   = ((document.getElementById('inp-telephone') as HTMLInputElement).value || '').trim();
  const etab  = ((document.getElementById('inp-etab-code') as HTMLInputElement).value || '').trim().toUpperCase();
  const errEl = document.getElementById('err1') as HTMLElement | null;
  if (errEl) errEl.style.display = 'none';

  if (!tel)  { afficherErreur('err1', 'Numéro de téléphone requis'); return; }
  if (!etab) { afficherErreur('err1', 'Code établissement requis'); return; }

  const btn = document.getElementById('btn-demander') as HTMLButtonElement | null;
  if (btn) { btn.disabled = true; btn.textContent = 'Envoi en cours\u2026'; }

  try {
    await Api.post('/auth/otp/demander', { telephone: tel, etablissement_code: etab });
    _telephone = tel;
    _etabCode  = etab;

    (document.getElementById('etape1') as HTMLElement).style.display = 'none';
    (document.getElementById('etape2') as HTMLElement).style.display = '';
    (document.getElementById('otp-hint') as HTMLElement).textContent = 'Code à 6 chiffres envoyé au ' + tel;
    (document.getElementById('otp-inputs')?.querySelectorAll('input')[0] as HTMLElement | null)?.focus();
    demarrerCooldown();
  } catch (e: any) {
    afficherErreur('err1', e.message || "Erreur lors de l'envoi du code");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '\uD83D\uDCF1 Recevoir le code SMS'; }
  }
}

async function validerOTP() {
  const inputs = document.getElementById('otp-inputs')?.querySelectorAll('input') || ([] as any[]);
  const code   = Array.from(inputs).map(function(i: any) { return i.value; }).join('');
  if (code.length < 6) { afficherErreur('err2', 'Saisissez les 6 chiffres du code'); return; }

  const btn = document.getElementById('btn-valider') as HTMLButtonElement | null;
  if (btn) { btn.disabled = true; btn.textContent = 'Connexion\u2026'; }

  try {
    const res = await Api.post('/auth/otp/valider', {
      telephone: _telephone, code, etablissement_code: _etabCode,
    });
    localStorage.setItem(CONFIG.TOKEN_KEY, res.data.token);
    localStorage.setItem(CONFIG.USER_KEY, JSON.stringify(res.data.utilisateur));
    window.location.href = 'parent.html';
  } catch (e: any) {
    afficherErreur('err2', e.message || 'Code incorrect ou expiré');
    Array.from(inputs).forEach(function(i: any) { i.value = ''; });
    (inputs[0] as HTMLElement | undefined)?.focus();
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Connexion \u2192'; }
  }
}

function avancerOTP(input: HTMLInputElement, idx: number) {
  if (input.value.length > 1) input.value = input.value.slice(-1);
  const inputs = document.getElementById('otp-inputs')?.querySelectorAll('input');
  if (input.value && idx < 5 && inputs) (inputs[idx + 1] as HTMLElement).focus();
}

function reculerOTP(e: KeyboardEvent, idx: number) {
  if (e.key === 'Backspace') {
    const inputs = document.getElementById('otp-inputs')?.querySelectorAll('input') as any;
    if (inputs && !inputs[idx].value && idx > 0) { inputs[idx - 1].value = ''; inputs[idx - 1].focus(); }
  }
}

async function renvoyerOTP() {
  if (_resendTimer) return;
  const err2 = document.getElementById('err2') as HTMLElement | null;
  if (err2) err2.style.display = 'none';
  try {
    await Api.post('/auth/otp/demander', { telephone: _telephone, etablissement_code: _etabCode });
    demarrerCooldown();
    document.getElementById('otp-inputs')?.querySelectorAll('input').forEach(function(i: any) { i.value = ''; });
    (document.getElementById('otp-inputs')?.querySelectorAll('input')[0] as HTMLElement | null)?.focus();
  } catch (e: any) {
    afficherErreur('err2', 'Erreur lors du renvoi');
  }
}

function demarrerCooldown() {
  let secs = 60;
  const el = document.getElementById('resend-msg') as HTMLElement | null;
  _resendTimer = setInterval(function() {
    secs--;
    if (secs <= 0) {
      clearInterval(_resendTimer); _resendTimer = null;
      if (el) {
        el.innerHTML = 'Pas re\u00e7u\u00a0? <span id="btn-renvoyer" style="color:var(--bleu);cursor:pointer;text-decoration:underline">Renvoyer</span>';
        document.getElementById('btn-renvoyer')?.addEventListener('click', renvoyerOTP);
      }
    } else {
      if (el) el.textContent = 'Renvoyer dans ' + secs + 's\u2026';
    }
  }, 1000);
}

function afficherErreur(id: string, msg: string) {
  const el = document.getElementById(id) as HTMLElement | null;
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'block';
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btn-demander')?.addEventListener('click', demanderOTP);
  document.getElementById('btn-valider')?.addEventListener('click', validerOTP);

  const otpInputs = document.getElementById('otp-inputs')?.querySelectorAll('input');
  otpInputs?.forEach((input, idx) => {
    input.addEventListener('input', () => avancerOTP(input as HTMLInputElement, idx));
    input.addEventListener('keydown', (e) => reculerOTP(e as KeyboardEvent, idx));
  });
});
