import { Api } from './api';

let _identifiant = '';
let _etabCode = '';
let _timerInterval: any = null;

async function demanderCode(e: Event) {
  e.preventDefault();
  const btn = document.getElementById('btn-etape1') as HTMLButtonElement | null;
  const errEl = document.getElementById('err-box') as HTMLElement | null;

  _identifiant = ((document.getElementById('input-identifiant') as HTMLInputElement | null)?.value || '').trim();
  _etabCode    = ((document.getElementById('input-etab') as HTMLInputElement | null)?.value || '').trim();

  if (btn) { btn.disabled = true; btn.textContent = 'Envoi en cours\u2026'; }
  errEl?.classList.remove('show');

  try {
    await Api.post('/auth/mot-de-passe-oublie', {
      identifiant: _identifiant, etablissement_code: _etabCode,
    });
    passerEtape(2);
    demarrerTimer(15 * 60);
  } catch (err: any) {
    if (errEl) { errEl.textContent = err.message || 'Erreur \u2014 r\u00e9essayez.'; errEl.classList.add('show'); }
    if (btn) { btn.disabled = false; btn.textContent = 'Envoyer le code'; }
  }
}

async function reinitialiser(e: Event) {
  e.preventDefault();
  const btn = document.getElementById('btn-etape2') as HTMLButtonElement | null;
  const errEl = document.getElementById('err-box') as HTMLElement | null;

  const code = Array.from(document.querySelectorAll('#otp-inputs input'))
    .map(function(i: any) { return i.value; }).join('');

  const mdp1 = ((document.getElementById('input-mdp1') as HTMLInputElement | null)?.value || '');
  const mdp2 = ((document.getElementById('input-mdp2') as HTMLInputElement | null)?.value || '');

  if (code.length !== 6) {
    if (errEl) { errEl.textContent = 'Veuillez saisir le code \u00e0 6 chiffres.'; errEl.classList.add('show'); }
    return;
  }
  if (mdp1 !== mdp2) {
    if (errEl) { errEl.textContent = 'Les mots de passe ne correspondent pas.'; errEl.classList.add('show'); }
    return;
  }

  if (btn) { btn.disabled = true; btn.textContent = 'R\u00e9initialisation\u2026'; }
  errEl?.classList.remove('show');

  try {
    await Api.post('/auth/reinitialiser-mot-de-passe', {
      identifiant: _identifiant, etablissement_code: _etabCode,
      code, nouveau_mot_de_passe: mdp1,
    });
    clearInterval(_timerInterval);
    passerEtape(3);
  } catch (err: any) {
    if (errEl) { errEl.textContent = err.message || 'Code invalide ou expir\u00e9.'; errEl.classList.add('show'); }
    if (btn) { btn.disabled = false; btn.textContent = 'R\u00e9initialiser'; }
  }
}

function passerEtape(n: number) {
  document.querySelectorAll('.step').forEach(function(el: any) { el.classList.remove('active'); });
  document.getElementById('step-' + n)?.classList.add('active');
  document.getElementById('err-box')?.classList.remove('show');

  const sousTitres: Record<number, string> = {
    1: 'Entrez votre identifiant pour recevoir un code',
    2: 'Entrez le code reçu par SMS et votre nouveau mot de passe',
    3: ''
  };
  const sousTitreEl = document.getElementById('sous-titre') as HTMLElement | null;
  if (sousTitreEl) sousTitreEl.textContent = sousTitres[n] || '';
}

function retourEtape1() {
  clearInterval(_timerInterval);
  passerEtape(1);
  const btn1 = document.getElementById('btn-etape1') as HTMLButtonElement | null;
  if (btn1) { btn1.disabled = false; btn1.textContent = 'Envoyer le code'; }
}

function demarrerTimer(secondes: number) {
  clearInterval(_timerInterval);
  let restant = secondes;
  function maj() {
    const m = Math.floor(restant / 60);
    const s = restant % 60;
    (document.getElementById('timer-val') as HTMLElement).textContent = m + ':' + (s < 10 ? '0' : '') + s;
    if (restant <= 0) {
      clearInterval(_timerInterval);
      (document.getElementById('timer-txt') as HTMLElement).textContent = 'Code expiré — renvoyez un nouveau code.';
    }
    restant--;
  }
  maj();
  _timerInterval = setInterval(maj, 1000);
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('form-etape1')?.addEventListener('submit', demanderCode);
  document.getElementById('form-etape2')?.addEventListener('submit', reinitialiser);
  document.getElementById('btn-retour')?.addEventListener('click', retourEtape1);
});

// OTP inputs keyboard navigation (runs after module is evaluated = after DOM parsed)
const otpInputs = document.querySelectorAll('#otp-inputs input');
otpInputs.forEach(function(input: any, i: number) {
  input.addEventListener('input', function(this: HTMLInputElement) {
    this.value = this.value.replace(/\D/g, '');
    if (this.value) {
      this.classList.add('filled');
      if (i < otpInputs.length - 1) (otpInputs[i + 1] as HTMLElement).focus();
    } else {
      this.classList.remove('filled');
    }
  });
  input.addEventListener('keydown', function(this: HTMLInputElement, e: KeyboardEvent) {
    if (e.key === 'Backspace' && !this.value && i > 0) {
      (otpInputs[i - 1] as HTMLInputElement).focus();
      (otpInputs[i - 1] as HTMLInputElement).value = '';
      otpInputs[i - 1].classList.remove('filled');
    }
  });
  input.addEventListener('paste', function(this: HTMLInputElement, e: ClipboardEvent) {
    const txt = ((e.clipboardData || (window as any).clipboardData).getData('text') || '').replace(/\D/g, '').slice(0, 6);
    otpInputs.forEach(function(inp: any, j: number) {
      inp.value = txt[j] || '';
      inp.classList.toggle('filled', !!txt[j]);
    });
    if (txt.length >= 6) (otpInputs[5] as HTMLElement).focus();
    e.preventDefault();
  });
});
