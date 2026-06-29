'use strict';

/**
 * Génère le HTML d'un bulletin de notes au format MEN (Afrique de l'Ouest francophone).
 * Destiné à être rendu par Puppeteer en PDF A4.
 *
 * @param {object} donnees - Structure identique à la réponse de GET /bulletins/:id
 * @returns {string} HTML complet (incluant <html>, <head>, <body>)
 */
function genererHTMLBulletin(donnees) {
  const { etablissement, eleve, periode, matieres, conduite, resultat, absences } = donnees;

  const fmt = (v) => (v !== null && v !== undefined ? String(v) : '—');
  const fmtMoy = (v) => (v !== null && v !== undefined ? Number(v).toFixed(2) : '—');
  const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // Regrouper les matières par discipline
  const parDiscipline = {};
  for (const m of matieres || []) {
    const disc = m.discipline || 'Autres';
    if (!parDiscipline[disc]) parDiscipline[disc] = [];
    parDiscipline[disc].push(m);
  }

  const MENTIONS = {
    tres_bien:   'Très Bien',
    bien:        'Bien',
    assez_bien:  'Assez Bien',
    passable:    'Passable',
    insuffisant: 'Insuffisant',
  };

  const DECISIONS = {
    felicitations:   'Félicitations du Conseil',
    encouragements:  'Encouragements du Conseil',
    tableau_honneur: "Tableau d'Honneur",
    avert_travail:   'Avertissement en Travail',
    avert_conduite:  'Avertissement en Conduite',
    aucune:          '—',
  };

  const mention  = MENTIONS[resultat.mention]          || fmt(resultat.mention);
  const decision = DECISIONS[resultat.decision_conseil] || fmt(resultat.decision_conseil);
  const moy      = fmtMoy(resultat.moyenne_generale);
  const moyColor = Number(resultat.moyenne_generale) >= 10 ? '#1a5c2a' : '#8b0000';

  function moyDevoirs(m) {
    if (m.somme_notes_devoirs !== null && m.nb_devoirs_comptes) {
      return (m.somme_notes_devoirs / m.nb_devoirs_comptes).toFixed(2);
    }
    return '—';
  }

  function ligneMatiere(m) {
    const compColor = Number(m.moyenne) >= 10 ? '#1a5c2a' : '#8b0000';
    return `
      <tr>
        <td style="padding:4px 6px;border:1px solid #ddd;">${esc(m.matiere)}</td>
        <td style="padding:4px 6px;border:1px solid #ddd;text-align:center;">${fmt(m.coefficient)}</td>
        <td style="padding:4px 6px;border:1px solid #ddd;text-align:center;">${moyDevoirs(m)}</td>
        <td style="padding:4px 6px;border:1px solid #ddd;text-align:center;">${fmt(m.note_composition)}</td>
        <td style="padding:4px 6px;border:1px solid #ddd;text-align:center;font-weight:600;color:${compColor};">${fmtMoy(m.moyenne)}</td>
        <td style="padding:4px 6px;border:1px solid #ddd;text-align:center;">${fmt(m.rang_dans_classe)}${m.rang_sur ? '/' + m.rang_sur : ''}</td>
        <td style="padding:4px 6px;border:1px solid #ddd;font-size:10px;">${esc(m.appreciation_enseignant)}</td>
      </tr>`;
  }

  function blocDiscipline(nom, list) {
    return `
      <tr>
        <td colspan="7" style="background:#1a3a5c;color:#fff;padding:4px 8px;font-weight:700;font-size:11px;letter-spacing:.5px;border:1px solid #1a3a5c;">
          ${esc(nom)}
        </td>
      </tr>
      ${list.map(ligneMatiere).join('')}`;
  }

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <title>Bulletin de Notes</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Arial, sans-serif; font-size: 11px; color: #1a1a1a; background: #fff; }
    .page { width: 190mm; padding: 8mm; background: #fff; }

    .header { display: flex; align-items: center; justify-content: space-between; border-bottom: 3px solid #1a3a5c; padding-bottom: 8px; margin-bottom: 10px; }
    .republique { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #1a3a5c; }
    .devise { font-size: 8px; color: #555; font-style: italic; }
    .ministere { font-size: 8px; color: #555; margin-top: 2px; }
    .school-name { font-size: 13px; font-weight: 800; color: #1a3a5c; text-transform: uppercase; }
    .school-sub { font-size: 9px; color: #555; }

    .bulletin-title { background: #1a3a5c; color: #fff; text-align: center; font-size: 12px; font-weight: 800; letter-spacing: 2px; text-transform: uppercase; padding: 6px; margin: 8px 0; }

    .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin-bottom: 10px; border: 1px solid #1a3a5c; padding: 8px; }
    .info-item { display: flex; gap: 4px; }
    .info-label { font-weight: 700; color: #1a3a5c; white-space: nowrap; }

    .notes-table { width: 100%; border-collapse: collapse; margin-bottom: 8px; font-size: 10px; }
    .notes-table th { background: #2c5f8a; color: #fff; padding: 5px 6px; border: 1px solid #2c5f8a; text-align: center; }
    .notes-table tr:nth-child(even) td { background: #f7f9fc; }

    .results-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; margin-bottom: 8px; }
    .result-box { border: 1px solid #1a3a5c; padding: 6px 8px; text-align: center; }
    .result-label { font-size: 9px; color: #555; text-transform: uppercase; font-weight: 600; }
    .result-value { font-size: 16px; font-weight: 800; }

    .abs-conduct { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 8px; }
    .section-box { border: 1px solid #ccc; padding: 6px 8px; }
    .section-title { font-weight: 700; color: #1a3a5c; font-size: 10px; text-transform: uppercase; margin-bottom: 4px; border-bottom: 1px solid #ddd; padding-bottom: 2px; }

    .decision-box { border: 2px solid #1a3a5c; padding: 6px 10px; margin-bottom: 8px; }

    .signatures { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin-top: 8px; border-top: 1px solid #ccc; padding-top: 8px; }
    .sig-block { text-align: center; }
    .sig-label { font-size: 10px; font-weight: 600; color: #1a3a5c; }
    .sig-line { border-bottom: 1px solid #555; height: 30px; margin: 4px 0; }
    .sig-note { font-size: 8px; color: #888; }
  </style>
</head>
<body>
<div class="page">

  <div class="header">
    <div style="flex:1;text-align:center;">
      <div class="republique">République du Sénégal</div>
      <div class="devise">Un Peuple — Un But — Une Foi</div>
      <div class="ministere">Ministère de l'Éducation Nationale</div>
    </div>
    <div style="flex:2;text-align:center;">
      ${etablissement.logo_url ? `<img src="${esc(etablissement.logo_url)}" alt="Logo" style="height:45px;margin-bottom:4px;"><br>` : ''}
      <div class="school-name">${esc(etablissement.nom)}</div>
      <div class="school-sub">${esc(etablissement.ville)}${etablissement.pays ? ' — ' + esc(etablissement.pays) : ''}</div>
      ${etablissement.code_officiel ? `<div class="school-sub">Code : ${esc(etablissement.code_officiel)}</div>` : ''}
    </div>
    <div style="flex:1;text-align:center;">
      <div style="font-size:9px;color:#555;">Année scolaire</div>
      <div style="font-size:12px;font-weight:700;color:#1a3a5c;">${esc(periode.annee_scolaire)}</div>
    </div>
  </div>

  <div class="bulletin-title">
    Bulletin de Notes — ${esc(periode.libelle)} (Trimestre ${esc(String(periode.trimestre))})
  </div>

  <div class="info-grid">
    <div class="info-item"><span class="info-label">Nom :</span> <span>${esc(eleve.nom)} ${esc(eleve.prenom)}</span></div>
    <div class="info-item"><span class="info-label">Classe :</span> <span>${esc(eleve.classe)}</span></div>
    <div class="info-item"><span class="info-label">Matricule :</span> <span>${esc(eleve.matricule)}</span></div>
    <div class="info-item"><span class="info-label">Né(e) le :</span> <span>${eleve.date_naissance ? new Date(eleve.date_naissance).toLocaleDateString('fr-FR') : '—'}</span></div>
  </div>

  <table class="notes-table">
    <thead>
      <tr>
        <th style="width:24%;">Matière</th>
        <th style="width:7%;">Coeff.</th>
        <th style="width:11%;">Moy. Devoirs</th>
        <th style="width:9%;">Compos.</th>
        <th style="width:10%;">Moyenne</th>
        <th style="width:9%;">Rang</th>
        <th>Appréciation</th>
      </tr>
    </thead>
    <tbody>
      ${Object.entries(parDiscipline).map(([nom, list]) => blocDiscipline(nom, list)).join('')}
    </tbody>
  </table>

  <div class="results-grid">
    <div class="result-box">
      <div class="result-label">Moyenne Générale</div>
      <div class="result-value" style="color:${moyColor};">${moy}/20</div>
    </div>
    <div class="result-box">
      <div class="result-label">Rang dans la Classe</div>
      <div class="result-value" style="color:#1a3a5c;">${fmt(resultat.rang)}/${fmt(resultat.rang_sur)}</div>
    </div>
    <div class="result-box">
      <div class="result-label">Mention</div>
      <div class="result-value" style="color:#1a3a5c;font-size:12px;">${esc(mention)}</div>
    </div>
  </div>

  <div class="abs-conduct">
    <div class="section-box">
      <div class="section-title">Absences &amp; Retards</div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;text-align:center;margin-top:4px;">
        <div>
          <div style="font-size:8px;color:#777;">Justifiées</div>
          <div style="font-size:14px;font-weight:700;">${fmt(absences.justifiees)}</div>
        </div>
        <div>
          <div style="font-size:8px;color:#777;">Injustifiées</div>
          <div style="font-size:14px;font-weight:700;color:#8b0000;">${fmt(absences.injustifiees)}</div>
        </div>
        <div>
          <div style="font-size:8px;color:#777;">Retards</div>
          <div style="font-size:14px;font-weight:700;">${fmt(absences.retards)}</div>
        </div>
      </div>
    </div>
    <div class="section-box">
      <div class="section-title">Conduite</div>
      ${conduite ? `
        <div style="display:flex;align-items:center;gap:8px;margin-top:4px;">
          <span style="font-size:18px;font-weight:800;color:#1a3a5c;">${fmt(conduite.valeur)}/10</span>
          <span style="font-size:10px;color:#555;">${esc(conduite.appreciation)}</span>
        </div>
        ${conduite.commentaire ? `<div style="font-size:9px;color:#777;margin-top:2px;font-style:italic;">${esc(conduite.commentaire)}</div>` : ''}
      ` : '<div style="color:#999;font-size:10px;margin-top:4px;">Non renseignée</div>'}
    </div>
  </div>

  <div class="decision-box">
    <span style="font-weight:700;color:#1a3a5c;">Décision du Conseil :</span>
    <span style="font-weight:600;margin-left:6px;">${esc(decision)}</span>
    ${resultat.appreciation_conseil ? `<span style="color:#555;font-style:italic;margin-left:8px;">— ${esc(resultat.appreciation_conseil)}</span>` : ''}
  </div>

  <div class="signatures">
    <div class="sig-block">
      <div class="sig-label">Le Chef d'Établissement</div>
      <div class="sig-line"></div>
      <div class="sig-note">(Cachet et signature)</div>
    </div>
    <div class="sig-block">
      <div class="sig-label">Le Professeur Principal</div>
      <div class="sig-line"></div>
      <div class="sig-note">(Signature)</div>
    </div>
    <div class="sig-block">
      <div class="sig-label">Le Parent / Tuteur</div>
      <div class="sig-line"></div>
      <div class="sig-note">(Lu et approuvé)</div>
    </div>
  </div>

  <div style="text-align:center;margin-top:8px;font-size:8px;color:#999;border-top:1px solid #eee;padding-top:4px;">
    Document généré le ${new Date().toLocaleDateString('fr-FR')} — ${esc(etablissement.nom)}${etablissement.telephone ? ' — Tél : ' + esc(etablissement.telephone) : ''}
  </div>

</div>
</body>
</html>`;
}

module.exports = { genererHTMLBulletin };
