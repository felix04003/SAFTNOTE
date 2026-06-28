// src/services/sync/syncService.ts
// Moteur de synchronisation bidirectionnel offline-first
// - Sync descendante : serveur → SQLite local (toutes les X minutes)
// - Sync montante : SQLite local → serveur (immédiatement si connecté)

import * as Network from 'expo-network';
import { syncApi } from '../api/client';
import { getDB, upsertEleves, upsertEvaluations, getOperationsPendantes, marquerOperationSynced } from '../storage/database';
import { useAuthStore } from '../../stores/authStore';

const INTERVALLE_SYNC_MS = 5 * 60 * 1000; // 5 minutes
const SYNC_KEY = 'derniere_sync';

class SyncService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private enCours = false;

  demarrer() {
    if (this.timer) return;
    // Sync immédiate au démarrage
    setTimeout(() => this.syncDescendante(), 2000);
    // Puis toutes les 5 minutes
    this.timer = setInterval(() => this.syncDescendante(), INTERVALLE_SYNC_MS);
  }

  arreter() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  // ── Sync descendante (serveur → local) ─────────────────────────
  async syncDescendante(): Promise<{ succes: boolean; message?: string }> {
    if (this.enCours) return { succes: false, message: 'Sync déjà en cours' };

    const session = useAuthStore.getState().session;
    if (!session) return { succes: false, message: 'Non connecté' };

    const connecte = await estConnecte();
    if (!connecte) return { succes: false, message: 'Hors ligne' };

    this.enCours = true;
    const db = getDB();

    try {
      // Récupérer la date de la dernière sync
      const row: any = await db.getFirstAsync(
        `SELECT derniere_sync FROM session WHERE utilisateur_id = ?`,
        [session.utilisateur_id]
      );
      const depuis = row?.derniere_sync || null;

      // Télécharger depuis l'API
      const res: any = await syncApi.telecharger(depuis);
      const { payload, sync_at } = res;

      // Persister selon le rôle
      if (session.role === 'enseignant' || session.role === 'directeur') {
        await persisterDonneesEnseignant(db, payload);
      } else if (session.role === 'parent') {
        await persisterDonneesParent(db, payload);
      }

      // Mettre à jour la date de la dernière sync
      await db.runAsync(
        `UPDATE session SET derniere_sync = ? WHERE utilisateur_id = ?`,
        [sync_at, session.utilisateur_id]
      );

      console.log('[Sync] ↓ Descendante OK', { sync_at });
      return { succes: true };

    } catch (err: any) {
      console.warn('[Sync] ↓ Erreur descendante', err.message);
      return { succes: false, message: err.message };
    } finally {
      this.enCours = false;
    }
  }

  // ── Sync montante (local → serveur) ────────────────────────────
  async syncMontante(): Promise<{ envoyees: number; echecs: number }> {
    const connecte = await estConnecte();
    if (!connecte) return { envoyees: 0, echecs: 0 };

    const operations = await getOperationsPendantes();
    if (operations.length === 0) return { envoyees: 0, echecs: 0 };

    const db = getDB();
    let envoyees = 0, echecs = 0;

    // Envoyer par batch de 20
    const BATCH = 20;
    for (let i = 0; i < operations.length; i += BATCH) {
      const batch = operations.slice(i, i + BATCH);
      try {
        const ops = batch.map(op => ({
          id:            op.id,
          type:          op.type,
          payload:       JSON.parse(op.payload),
          cree_at_local: op.created_at_local,
        }));

        const res: any = await syncApi.envoyer(ops);
        const resultats: any[] = res.resultats || [];

        for (const r of resultats) {
          if (r.statut === 'ok') {
            await marquerOperationSynced(r.op_id);
            envoyees++;
          } else {
            await db.runAsync(
              `UPDATE operations_pending SET statut='erreur', erreur_msg=?, tentatives=tentatives+1 WHERE id=?`,
              [r.detail || r.code, r.op_id]
            );
            echecs++;
          }
        }
      } catch (err: any) {
        console.warn('[Sync] ↑ Batch échoué', err.message);
        echecs += batch.length;
      }
    }

    console.log('[Sync] ↑ Montante', { envoyees, echecs });
    return { envoyees, echecs };
  }

  // Sync complète (descendante + montante)
  async syncComplete(): Promise<void> {
    await this.syncMontante();
    await this.syncDescendante();
  }
}

// ── Persistance données enseignant ──────────────────────────────
async function persisterDonneesEnseignant(db: any, payload: any) {
  if (!payload) return;

  if (payload.eleves?.length) await upsertEleves(payload.eleves);
  if (payload.evaluations?.length) await upsertEvaluations(payload.evaluations);

  if (payload.notes?.length) {
    for (const n of payload.notes) {
      await db.runAsync(
        `INSERT INTO notes (id, evaluation_id, eleve_id, inscription_id, valeur, est_absent, absence_justifiee, synced)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1)
         ON CONFLICT(id) DO UPDATE SET valeur=excluded.valeur, est_absent=excluded.est_absent, synced=1`,
        [n.id, n.evaluation_id, n.eleve_id, n.inscription_id,
         n.valeur, n.est_absent ? 1 : 0, n.absence_justifiee ? 1 : 0]
      );
    }
  }

  if (payload.edt?.length) {
    await db.runAsync('DELETE FROM edt');
    for (const e of payload.edt) {
      await db.runAsync(
        `INSERT OR REPLACE INTO edt (id, jour_semaine, heure_debut, heure_fin, matiere, classe_id, classe, salle)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [e.id, e.jour_semaine, e.heure_debut, e.heure_fin,
         e.matiere, e.classe_id, e.classe, e.salle]
      );
    }
  }
}

// ── Persistance données parent ───────────────────────────────────
async function persisterDonneesParent(db: any, payload: any) {
  if (!payload) return;

  if (payload.enfants?.length) {
    for (const e of payload.enfants) {
      await db.runAsync(
        `INSERT OR REPLACE INTO eleves (id, nom, prenom, inscription_id, classe)
         VALUES (?, ?, ?, ?, ?)`,
        [e.id, e.nom, e.prenom, e.inscription_id, e.classe]
      );
    }
  }

  if (payload.notes?.length) {
    for (const n of payload.notes) {
      if (!n.id) continue;
      await db.runAsync(
        `INSERT OR REPLACE INTO notes_parent (id, eleve_id, matiere, type_eval, date_evaluation, valeur, trimestre, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [n.id, n.eleve_id, n.matiere, n.type, n.date_evaluation, n.valeur, n.trimestre, new Date().toISOString()]
      );
    }
  }

  if (payload.absences?.length) {
    for (const a of payload.absences) {
      if (!a.id) continue;
      await db.runAsync(
        `INSERT OR REPLACE INTO absences (id, eleve_id, date_cours, matiere, statut, est_justifie, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [a.id, a.eleve_id, a.date_cours, a.matiere,
         a.statut, a.est_justifie ? 1 : 0, new Date().toISOString()]
      );
    }
  }

  if (payload.bulletins?.length) {
    for (const b of payload.bulletins) {
      await db.runAsync(
        `INSERT OR REPLACE INTO bulletins (id, eleve_id, trimestre, moyenne_generale, rang, rang_sur, mention, bulletin_url, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [b.id || Date.now(), b.eleve_id, b.trimestre, b.moyenne_generale, b.rang, b.rang_sur, b.mention, b.bulletin_url, new Date().toISOString()]
      );
    }
  }
}

async function estConnecte(): Promise<boolean> {
  const state = await Network.getNetworkStateAsync();
  return !!(state.isConnected && state.isInternetReachable);
}

export const syncService = new SyncService();
