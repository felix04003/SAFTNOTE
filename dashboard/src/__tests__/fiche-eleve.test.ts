import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Api, ApiError } from '../api';
import { PageFicheEleve, grillePeriodes } from '../pages/fiche-eleve';

afterEach(() => { vi.restoreAllMocks(); });

describe('grillePeriodes', () => {
  it('une ligne par matière (ordre alphabétique), une colonne par période, trous conservés', () => {
    const g = grillePeriodes([
      { matiere: 'Maths', trimestre: 1, moyenne: 15, coefficient: 3 },
      { matiere: 'Français', trimestre: 1, moyenne: 12, coefficient: 3 },
      { matiere: 'Maths', trimestre: 2, moyenne: 16, coefficient: 3 },
    ]);
    expect(g.periodes).toEqual([1, 2]);
    expect(g.lignes.map((l) => l.matiere)).toEqual(['Français', 'Maths']);
    expect(g.lignes[0].parPeriode).toEqual({ 1: 12 });
    expect(g.lignes[1].parPeriode).toEqual({ 1: 15, 2: 16 });
  });
  it('sans moyenne : tableau vide', () => {
    expect(grillePeriodes([])).toEqual({ periodes: [], lignes: [] });
  });
});

const identite = {
  prenom: 'Fatou', nom: 'Ndiaye', matricule: 'E26123456', genre: 'F', date_naissance: '2013-03-14T00:00:00.000Z',
  date_inscription: '2026-10-01T00:00:00.000Z', adresse: null, classe: '6ème A', annee: '2026-2027', medical_masque: true,
  parents: [{ id: 'p1', prenom: 'Papa', nom: 'Ndiaye', telephone: '+221770000001', lien: 'pere', est_contact_principal: true }],
};

function brancher(reponses: Record<string, any>) {
  vi.spyOn(Api, 'get').mockImplementation(async (chemin: string) => {
    const cle = Object.keys(reponses).find((k) => chemin.endsWith(k));
    const r = cle ? reponses[cle] : { data: [] };
    if (r instanceof Error) throw r;
    return r;
  });
}

describe('PageFicheEleve', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="tc"></div><h1 id="fiche-eleve-titre"></h1><div id="fiche-eleve-contenu"></div>';
    PageFicheEleve._id = 'u1';
  });

  it('affiche identité, parents, résultats, notes, absences et discipline ; échappe le HTML', async () => {
    brancher({
      '/eleves/u1': { data: { ...identite, nom: '<i>Ndiaye</i>' } },
      '/moyennes/eleve/u1': { data: { classe: '6ème A', moyennes_generales: [{ trimestre: 1, periode: 'Trimestre 1', moyenne_generale: '14.25', rang: 2, rang_sur: 30, mention: 'Bien' }],
        moyennes_matieres: [{ matiere: 'Maths', trimestre: 1, moyenne: '15.00', coefficient: 3 }] } },
      '/eleves/u1/notes': { data: [{ date_evaluation: '2026-11-12', matiere: 'Maths', type: 'devoir', valeur: '15.00' }] },
      '/eleves/u1/tableau-de-bord': { data: { absences: { justifiees: '1', injustifiees: '2', retards: '3' } } },
      '/eleves/u1/absences': { data: [{ date_cours: '2026-11-03T00:00:00.000Z', matiere: 'Maths', est_justifie: false }] },
      '/discipline/eleves/u1/dossier': { data: { incidents: [], sanctions: [{ date_prononcee: '2026-11-05', type: 'avertissement_oral', motif: 'Bavardage' }] } },
    });
    await PageFicheEleve.charger();
    const html = document.getElementById('fiche-eleve-contenu')!;
    const texte = html.textContent!;
    expect(texte).toContain('E26123456');
    expect(texte).toContain('14/03/2013');
    expect(texte).toContain('Contact principal');
    expect(texte).toContain('+221770000001');
    expect(texte).toContain('14.25/20');
    expect(texte).toContain('Rang 2/30');
    expect(texte).toContain('12/11/2026');
    expect(texte).toContain('03/11/2026');
    expect(texte).toContain('Bavardage');
    expect(texte).toContain('Données médicales réservées à la direction');
    expect(html.innerHTML).not.toContain('<i>Ndiaye</i>');
    expect(document.getElementById('fiche-eleve-titre')!.textContent).toContain('Fatou');
  });

  it('sans le droit « discipline », la section est absente ; une autre panne est signalée sans casser le reste', async () => {
    brancher({
      '/eleves/u1': { data: identite },
      '/discipline/eleves/u1/dossier': new ApiError('Permission requise', 'PERMISSION', 403),
      '/moyennes/eleve/u1': new ApiError('Panne', 'ERR', 500),
    });
    await PageFicheEleve.charger();
    const texte = document.getElementById('fiche-eleve-contenu')!.textContent!;
    expect(texte).not.toContain('Discipline');
    expect(texte).toContain('Résultats');
    expect(texte).toContain('Indisponible : Panne');
    expect(texte).toContain('Ndiaye');                          // le reste de la fiche est là
  });

  it('données médicales : affichées pour la direction, « aucune donnée » si rien n\'est renseigné', async () => {
    brancher({ '/eleves/u1': { data: { ...identite, medical_masque: false, allergies: 'Arachides', groupe_sanguin: 'O+' } } });
    await PageFicheEleve.charger();
    let texte = document.getElementById('fiche-eleve-contenu')!.textContent!;
    expect(texte).toContain('Arachides');
    expect(texte).toContain('O+');
    expect(texte).not.toContain('réservées à la direction');

    brancher({ '/eleves/u1': { data: { ...identite, medical_masque: false } } });
    await PageFicheEleve.charger();
    texte = document.getElementById('fiche-eleve-contenu')!.textContent!;
    expect(texte).toContain('Aucune donnée médicale renseignée');
  });

  it('élève sans parent : le dit (aucune notification possible)', async () => {
    brancher({ '/eleves/u1': { data: { ...identite, parents: [] } } });
    await PageFicheEleve.charger();
    expect(document.getElementById('fiche-eleve-contenu')!.textContent).toContain('Aucun parent enregistré');
  });

  it('élève introuvable : message, pas de page vide', async () => {
    brancher({ '/eleves/u1': new ApiError('Élève introuvable', 'NOT_FOUND', 404) });
    await PageFicheEleve.charger();
    expect(document.getElementById('fiche-eleve-contenu')!.textContent).toContain('Élève introuvable');
  });
});
