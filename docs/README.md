# Documents de référence

Placer ici les fichiers téléchargés depuis Claude.ai :

| Fichier | Description |
|---------|-------------|
| `architecture_technique.docx` | Architecture complète (35 pages) |
| `guide_migrations_sql.docx` | Schéma base de données (20 pages) |
| `guide_mobile.docx` | Guide technique mobile (10 chapitres) |
| `strategie_sms_whatsapp.docx` | Intégration notifications (13 pages) |
| `etude_terrain.pptx` | Étude terrain Afrique de l'Ouest (11 slides) |

Ces documents sont référencés dans `CLAUDE.md` et contiennent les décisions
d'architecture, le schéma SQL complet, et les spécifications détaillées.

## Web ou mobile : qui fonctionne hors connexion ?

- **Dashboard web** : en ligne uniquement. Sans réseau, un bandeau l'indique et les boutons
  d'enregistrement (appel, notes, évaluation, sanction) sont désactivés.
- **Application mobile** : fonctionne hors connexion (appel et notes enregistrés en local), puis
  synchronise au retour du réseau. C'est le choix à privilégier en zone à connexion intermittente.
