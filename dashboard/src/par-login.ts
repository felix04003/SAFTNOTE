import { CONFIG } from './config';
import { Api } from './api';

var _telephone = '';
var _etabCode = '';
var _resendTimer: any = null;

(window as any).demanderOTP = async function() {
  var tel   = ((document.getElementById('inp-telephone') as HTMLInputElement).value || '').trim();
  var etab  = ((document.getElementById('inp-etab-code') as HTMLInputElement).value || '').trim().toUpperCase();
  var errEl = document.getElementById('err1')!;
  errEl.style.display = 'none';

  if (!tel)  { afficherErreur('err1', 'Numéro de téléphone requis'); return; }
  if (!etab) { afficherErreur('err1', 'Code établissement requis'); return; }

  var btn = document.getElementById('btn-demander') as HTMLButtonElement;
  btn.disabled = true; btn.textContent = 'Envoi en cours…';

  try {
    await Api.post('/auth/otp/demander', { telephone: tel, etablissement_code: etab });
    _telephone = tel;
    _etabCode  = etab;

    (document.getElementById('etape1') as HTMLElement).style.display = 'none';
    (document.getElementById('etape2') as HTMLElement).style.display = '';
    (document.getElementById('otp-hint') as HTMLElement).textContent = 'Code à 6 chiffres envoyé au ' + tel;
    (document.getElementById('otp-inputs')!.querySelectorAll('input')[0] as HTMLElement).focus();
    demarrerCooldown();
  } catch (e: any) {
    afficherErreur('err1', e.message || "Erreur lors de l'envoi du code");
  } finally {
    btn.disabled = false; btn.textContent = '📱 Recevoir le code SMS';
  }
};

(window as any).validerOTP = async function() {
  var inputs = document.getElementById('otp-inputs')!.querySelectorAll('input');
  var code   = Array.from(inputs).map(function(i: any) { return i.value; }).join('');
  if (code.length < 6) { afficherErreur('err2', 'Saisissez les 6 chiffres du code'); return; }

  var btn = document.getElementById('btn-valider') as HTMLButtonElement;
  btn.disabled = true; btn.textContent = 'Connexion…';

  try {
    var res = await Api.post('/auth/otp/valider', {
      telephone: _telephone, code, etablissement_code: _etabCode,
    });
    localStorage.setItem(CONFIG.TOKEN_KEY, res.data.token);
    localStorage.setItem(CONFIG.USER_KEY, JSON.stringify(res.data.utilisateur));
    window.location.href = 'parent.html';
  } catch (e: any) {
    afficherErreur('err2', e.message || 'Code incorrect ou expiré');
    inputs.forEach(function(i: any) { i.value = ''; });
    (inputs[0] as HTMLElement).focus();
  } finally {
    btn.disabled = false; btn.textContent = 'Connexion →';
  }
};

(window as any).avancerOTP = function(input: HTMLInputElement, idx: number) {
  if (input.value.length > 1) input.value = input.value.slice(-1);
  var inputs = document.getElementById('otp-inputs')!.querySelectorAll('input');
  if (input.value && idx < 5) (inputs[idx + 1] as HTMLElement).focus();
};

(window as any).reculerOTP = function(e: KeyboardEvent, idx: number) {
  if (e.key === 'Backspace') {
    var inputs = document.getElementById('otp-inputs')!.querySelectorAll('input') as any;
    if (!inputs[idx].value && idx > 0) { inputs[idx - 1].value = ''; inputs[idx - 1].focus(); }
  }
};

(window as any).renvoyerOTP = async function() {
  if (_resendTimer) return;
  (document.getElementById('err2') as HTMLElement).style.display = 'none';
  try {
    await Api.post('/auth/otp/demander', { telephone: _telephone, etablissement_code: _etabCode });
    demarrerCooldown();
    document.getElementById('otp-inputs')!.querySelectorAll('input').forEach(function(i: any) { i.value = ''; });
    (document.getElementById('otp-inputs')!.querySelectorAll('input')[0] as HTMLElement).focus();
  } catch (e: any) {
    afficherErreur('err2', 'Erreur lors du renvoi');
  }
};

function demarrerCooldown() {
  var secs = 60;
  var el   = document.getElementById('resend-msg')!;
  _resendTimer = setInterval(function() {
    secs--;
    if (secs <= 0) {
      clearInterval(_resendTimer); _resendTimer = null;
      el.innerHTML = 'Pas reçu ? <a onclick="renvoyerOTP()">Renvoyer</a>';
    } else {
      el.textContent = 'Renvoyer dans ' + secs + 's…';
    }
  }, 1000);
}

function afficherErreur(id: string, msg: string) {
  var el = document.getElementById(id)!;
  el.textContent = msg;
  (el as HTMLElement).style.display = 'block';
}
