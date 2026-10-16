import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PageEnseignants } from '../pages/enseignants';

describe('PageEnseignants.annoncerMotDePasse', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div class="tc" id="tc"></div>';
    window.prompt = vi.fn();
  });

  it('SMS parti : confirmation seule, jamais de boîte avec le mot de passe', () => {
    PageEnseignants.annoncerMotDePasse(
      { sms_envoye: true, message: 'Compte créé. Un SMS a été envoyé au +221771110001.' }, 'Enseignant créé ✓');
    expect(window.prompt).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('SMS a été envoyé');
  });

  it('SMS non parti : le mot de passe est proposé dans une boîte copiable', () => {
    PageEnseignants.annoncerMotDePasse(
      { sms_envoye: false, message: 'Compte créé, mais le SMS n\'a pas pu être envoyé. Mot de passe provisoire : KyKXPuFM3ttb' }, 'Enseignant créé ✓');
    expect(window.prompt).toHaveBeenCalledWith(expect.stringContaining('pas pu être envoyé'), 'KyKXPuFM3ttb');
  });
});
