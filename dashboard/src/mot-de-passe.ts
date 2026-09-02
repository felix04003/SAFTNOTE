import { Api } from './api';

var _identifiant = '';
var _etabCode = '';
var _timerInterval: any = null;

(window as any).demanderCode = async function(e: Event) {
  e.preventDefault();
  var btn = document.getElementById('btn-etape1') as HTMLButtonElement;
  var errEl = document.getElementById('err-box')!;

  _identifiant = ((document.getElementById('input-identifiant') as HTMLInputElement).value || '').trim();
  _etabCode    = ((document.getElementById('input-etab') as HTMLInputElement).value || '').trim();

  btn.disabled = true;
  btn.textContent = 'Envoi en cours…';
  errEl.classList.remove('show');

  try {
    await Api.post('/auth/mot-de-passe-oublie', {
      identifiant: _identifiant, etablissement_code: _etabCode,
    });
    passerEtape(2);
    demarrerTimer(15 * 60);
  } catch (err: any) {
    errEl.textContent = err.message || 'Erreur — réessayez.';
    errEl.classList.add('show');
    btn.disabled = false;
    btn.textContent = 'Envoyer le code';
  }
};

(window as any).reinitialiser = async function(e: Event) {
  e.preventDefault();
  var btn = document.getElementById('btn-etape2') as HTMLButtonElement;
  var errEl = document.getElementById('err-box')!;

  var code = Array.from(document.querySelectorAll('#otp-inputs input'))
    .map(function(i: any) { return i.value; }).join('');

  var mdp1 = ((document.getElementById('input-mdp1') as HTMLInputElement).value || '');
  var mdp2 = ((document.getElementById('input-mdp2') as HTMLInputElement).value || '');

  if (code.length !== 6) {
    errEl.textContent = 'Veuillez saisir le code à 6 chiffres.';
    errEl.classList.add('show'); return false;
  }
  if (mdp1 !== mdp2) {
    errEl.textContent = 'Les mots de passe ne correspondent pas.';
    errEl.classList.add('show'); return false;
  }

  btn.disabled = true;
  btn.textContent = 'Réinitialisation…';
  errEl.classList.remove('show');

  try {
    await Api.post('/auth/reinitialiser-mot-de-passe', {
      identifiant: _identifiant, etablissement_code: _etabCode,
      code, nouveau_mot_de_passe: mdp1,
    });
    clearInterval(_timerInterval);
    passerEtape(3);
  } catch (err: any) {
    errEl.textContent = err.message || 'Code invalide ou expiré.';
    errEl.classList.add('show');
    btn.disabled = false;
    btn.textContent = 'Réinitialiser';
  }
};

function passerEtape(n: number) {
  document.querySelectorAll('.step').forEach(function(el: any) { el.classList.remove('active'); });
  document.getElementById('step-' + n)!.classList.add('active');
  document.getElementById('err-box')!.classList.remove('show');

  var sousTitres: Record<number, string> = {
    1: 'Entrez votre identifiant pour recevoir un code',
    2: 'Entrez le code reçu par SMS et votre nouveau mot de passe',
    3: ''
  };
  (document.getElementById('sous-titre') as HTMLElement).textContent = sousTitres[n] || '';
}
(window as any).passerEtape = passerEtape;

(window as any).retourEtape1 = function() {
  clearInterval(_timerInterval);
  passerEtape(1);
  var btn1 = document.getElementById('btn-etape1') as HTMLButtonElement;
  btn1.disabled = false;
  btn1.textContent = 'Envoyer le code';
};

function demarrerTimer(secondes: number) {
  clearInterval(_timerInterval);
  var restant = secondes;
  function maj() {
    var m = Math.floor(restant / 60);
    var s = restant % 60;
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

// OTP inputs keyboard navigation (runs after module is evaluated = after DOM parsed)
var otpInputs = document.querySelectorAll('#otp-inputs input');
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
    var txt = ((e.clipboardData || (window as any).clipboardData).getData('text') || '').replace(/\D/g, '').slice(0, 6);
    otpInputs.forEach(function(inp: any, j: number) {
      inp.value = txt[j] || '';
      inp.classList.toggle('filled', !!txt[j]);
    });
    if (txt.length >= 6) (otpInputs[5] as HTMLElement).focus();
    e.preventDefault();
  });
});
