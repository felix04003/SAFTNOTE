# Stratégie de déploiement et modèle financier — EcoleManager SaaS

**Date :** 2026-04-14
**Statut :** Validé
**Projet :** EcoleManager (senote / enote)
**Cible :** Établissements scolaires Afrique de l'Ouest francophone

---

## Contexte

EcoleManager est un système de gestion scolaire offline-first multi-tenant. L'architecture est déjà conçue pour le SaaS (isolation par `etablissement_id`). L'objectif est de déployer progressivement en minimisant les coûts jusqu'au premier revenu, puis de scaler à mesure que la clientèle croît.

**Stade actuel :** 0 client signé — phase de démarchage commercial.

---

## Principe directeur

> **L'infrastructure doit suivre le client, pas le précéder.**

Ne pas investir dans un serveur de production tant qu'aucun établissement n'a signé. Déployer d'abord pour démarcher, facturer dès la signature, puis migrer vers l'infrastructure de prod avec le premier revenu.

---

## Les 3 phases

### Phase 0 — Démo (stade actuel)

**Objectif :** Avoir une URL live fonctionnelle pour les démonstrations commerciales.

| Paramètre | Valeur |
|-----------|--------|
| Plateforme | Railway (Starter) |
| Coût | $0/mois (crédit gratuit inclus) |
| Temps de déploiement | ~1 heure |
| Services inclus | API Node.js + PostgreSQL + Redis |
| Limite acceptable | Sleep après inactivité — acceptable pour démo |

**Déclencheur de passage à la Phase 1 :** 1er établissement signé.

---

### Phase 1 — Pilotes (1–5 établissements)

**Objectif :** Infrastructure stable, URL permanente, HTTPS, premier revenu.

| Paramètre | Valeur |
|-----------|--------|
| Serveur | Hetzner CX22 (2 vCPU, 4 GB RAM) |
| Coût serveur | ~€3.99/mois |
| Domaine | ~€10/an (senote.com ou enote.sn) |
| SSL | Gratuit — Let's Encrypt via Nginx |
| Stack déploiement | Docker Compose + Nginx reverse proxy |
| Coût total mensuel | **~€5/mois** |

**Rentabilité :** 1 seul client à 15 000 XOF/mois (~€23) couvre intégralement l'infrastructure.

**Déclencheur de passage à la Phase 2 :** 10+ établissements actifs ou dégradation des performances.

---

### Phase 2 — Croissance (10+ établissements)

**Objectif :** Scaler sans changer d'architecture ni de provider.

| Paramètre | Valeur |
|-----------|--------|
| Upgrade | Hetzner CX32 (4 vCPU, 8 GB RAM) — 1 clic |
| Coût serveur | ~€7.49/mois |
| Revenu estimé (10 clients) | ~150 000 XOF/mois (~€230) |
| Marge nette infrastructure | **~97%** |

L'upgrade Hetzner est instantané, sans migration de données, sans downtime.

---

## Modèle de tarification établissements

### Abonnement mensuel

| Taille de l'établissement | Tarif mensuel | Tarif annuel (−2 mois offerts) |
|---------------------------|---------------|-------------------------------|
| Petit (< 200 élèves) | 15 000 XOF | 150 000 XOF |
| Moyen (200–500 élèves) | 25 000 XOF | 250 000 XOF |
| Grand (500+ élèves) | 40 000 XOF | 400 000 XOF |

### Recommandation : privilégier le paiement annuel

- Améliore la trésorerie (encaissement en avance)
- Réduit le churn (l'établissement est engagé sur l'année scolaire)
- Aligner sur le calendrier scolaire : paiement en **septembre** (rentrée)

---

## Moyens de paiement

Cibler les outils dominants en Afrique de l'Ouest, sans friction :

| Moyen | Pays prioritaires | Friction |
|-------|------------------|---------|
| **Wave** | Sénégal, Côte d'Ivoire | Très faible |
| **Orange Money** | Tous pays cibles | Faible |
| Virement bancaire | Établissements publics | Moyenne |

> Éviter Stripe / carte bancaire dans un premier temps — très peu répandus chez les établissements scolaires locaux.

---

## Tableau de rentabilité

| Nb établissements | Revenu mensuel (XOF) | Revenu mensuel (€) | Coût infra (€) | Marge |
|:-----------------:|:-------------------:|:-----------------:|:--------------:|:-----:|
| 0 | 0 | 0 | 0 | — |
| 1 | 15 000 | ~€23 | €4 | ~83% |
| 3 | 60 000 | ~€92 | €4 | ~96% |
| 5 | 100 000 | ~€153 | €4 | ~97% |
| 10 | 200 000 | ~€305 | €7.50 | ~98% |
| 20 | 400 000 | ~€610 | €7.50 | ~99% |

*(Tarif moyen pondéré : 20 000 XOF/établissement)*

---

## Architecture technique par phase

### Phase 0 — Railway

```
Internet → Railway (API Node.js) → Railway PostgreSQL
                                 → Upstash Redis (free tier)
```

### Phase 1 & 2 — Hetzner VPS

```
Internet → Nginx (SSL + reverse proxy)
               → API Node.js (Docker, port 3000)
               → PostgreSQL (Docker, port 5432)
               → Redis (Docker, port 6379)
               → MinIO (Docker, port 9000)
               → Worker BullMQ (Docker)
```

---

## Roadmap commerciale suggérée

| Période | Action | Infra |
|---------|--------|-------|
| Avril–Mai 2026 | Démarchage 5–10 établissements pilotes | Railway (Phase 0) |
| Juin 2026 | Signature 1er contrat | Migrer sur Hetzner CX22 (Phase 1) |
| Rentrée sept. 2026 | Lancement officiel + facturation annuelle | Hetzner CX22 |
| Déc. 2026 | 10+ établissements actifs | Upgrade Hetzner CX32 (Phase 2) |

---

## Prochaine étape technique

**Déploiement Phase 0 sur Railway :**
1. Créer un projet Railway
2. Déployer l'API depuis le repo GitHub
3. Provisionner PostgreSQL + Redis
4. Appliquer les migrations
5. Configurer les variables d'environnement
6. Obtenir l'URL de démo

Durée estimée : **~1 heure**.
