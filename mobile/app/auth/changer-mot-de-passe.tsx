// app/auth/changer-mot-de-passe.tsx
// Changement du mot de passe — obligatoire à la première connexion avec un
// mot de passe provisoire (le serveur refuse tout le reste tant que ce n'est
// pas fait), volontaire sinon.
import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useRouter }     from 'expo-router';
import { Ionicons }      from '@expo/vector-icons';
import { SafeAreaView }  from 'react-native-safe-area-context';
import { useAuthStore }  from '../../src/stores/authStore';
import { authApi }       from '../../src/services/api/client';
import { verifierMotDePasse } from '../../src/utils/motDePasse';
import { Colors, Spacing, Radius, Shadow } from '../../src/utils/theme';
import Bouton            from '../../src/components/ui/Bouton';

export default function ChangerMotDePasseScreen() {
  const router      = useRouter();
  const obligatoire = useAuthStore(s => !!s.session?.doit_changer_mdp);
  const role        = useAuthStore(s => s.session?.role);
  const mdpChange   = useAuthStore(s => s.mdpChange);
  const deconnexion = useAuthStore(s => s.deconnexion);

  const [actuel,   setActuel]   = useState('');
  const [nouveau,  setNouveau]  = useState('');
  const [confirme, setConfirme] = useState('');
  const [voir,     setVoir]     = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [erreur,   setErreur]   = useState('');

  async function valider() {
    if (!actuel) return setErreur('Saisissez votre mot de passe actuel.');
    if (nouveau !== confirme) return setErreur('Les mots de passe ne correspondent pas.');
    if (nouveau === actuel) return setErreur('Le nouveau mot de passe doit être différent de l\'actuel.');
    const regle = verifierMotDePasse(nouveau);
    if (regle) return setErreur(regle);

    setLoading(true); setErreur('');
    try {
      await authApi.changerMotDePasse({ mot_de_passe_actuel: actuel, nouveau_mot_de_passe: nouveau });
      await mdpChange();
      router.replace(
        role === 'parent' ? '/(app)/parent'
          : ['directeur', 'censeur'].includes(role ?? '') ? '/(app)/directeur'
          : '/(app)/enseignant'
      );
    } catch (err: any) {
      setErreur(err.message || 'Changement impossible. Réessayez.');
    } finally { setLoading(false); }
  }

  async function seDeconnecter() {
    await deconnexion();
    router.replace('/auth/connexion');
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.hero}>
            <View style={styles.logoContainer}><Ionicons name="key" size={40} color={Colors.white} /></View>
            <Text style={styles.titre}>Nouveau mot de passe</Text>
          </View>

          <View style={[styles.carte, Shadow.lg]}>
            {obligatoire && (
              <View style={styles.info}>
                <Ionicons name="information-circle-outline" size={18} color={Colors.primary} />
                <Text style={styles.infoTexte}>
                  Votre mot de passe actuel est provisoire. Choisissez-en un nouveau, que vous seul connaîtrez, pour continuer.
                </Text>
              </View>
            )}

            <Text style={styles.label}>Mot de passe actuel</Text>
            <TextInput style={styles.input} value={actuel} onChangeText={t => { setActuel(t); setErreur(''); }} secureTextEntry={!voir} autoCapitalize="none" autoCorrect={false} />

            <Text style={styles.label}>Nouveau mot de passe</Text>
            <TextInput style={styles.input} value={nouveau} onChangeText={t => { setNouveau(t); setErreur(''); }} secureTextEntry={!voir} autoCapitalize="none" autoCorrect={false} />
            <Text style={styles.aide}>8 caractères minimum, avec une majuscule, une minuscule et un chiffre.</Text>

            <Text style={styles.label}>Confirmer le nouveau mot de passe</Text>
            <TextInput style={styles.input} value={confirme} onChangeText={t => { setConfirme(t); setErreur(''); }} secureTextEntry={!voir} autoCapitalize="none" autoCorrect={false} />

            <TouchableOpacity onPress={() => setVoir(!voir)} style={styles.voirBtn}>
              <Ionicons name={voir ? 'eye-off-outline' : 'eye-outline'} size={16} color={Colors.gray400} />
              <Text style={styles.voirLabel}>{voir ? 'Masquer' : 'Afficher'} les mots de passe</Text>
            </TouchableOpacity>

            {!!erreur && <Text style={styles.erreur}>{erreur}</Text>}

            <Bouton label="Enregistrer" onPress={valider} chargement={loading} pleineLargeur style={styles.bouton} />

            <TouchableOpacity onPress={seDeconnecter} style={styles.deco} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <Text style={styles.decoLabel}>Se déconnecter</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: Colors.primary },
  flex:   { flex: 1 },
  scroll: { flexGrow: 1, padding: Spacing.lg, justifyContent: 'center' },
  hero:   { alignItems: 'center', marginBottom: Spacing.lg },
  logoContainer: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.18)', marginBottom: Spacing.sm },
  titre:  { fontSize: 22, fontWeight: '700', color: Colors.white },
  carte:  { backgroundColor: Colors.white, borderRadius: Radius.lg, padding: Spacing.lg },
  info:   { flexDirection: 'row', gap: 8, backgroundColor: Colors.gray100, borderRadius: Radius.md, padding: Spacing.sm, marginBottom: Spacing.md },
  infoTexte: { flex: 1, fontSize: 12.5, color: Colors.gray700 },
  label:  { fontSize: 12, fontWeight: '600', color: Colors.gray700, marginTop: Spacing.sm, marginBottom: 4 },
  input:  { borderWidth: 1, borderColor: Colors.gray200, borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: 10, fontSize: 15, color: Colors.gray900 },
  aide:   { fontSize: 11.5, color: Colors.gray500, marginTop: 4 },
  voirBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: Spacing.md },
  voirLabel: { fontSize: 12.5, color: Colors.gray500 },
  erreur: { color: Colors.danger, fontSize: 13, marginTop: Spacing.md },
  bouton: { marginTop: Spacing.lg },
  deco:   { alignItems: 'center', marginTop: Spacing.lg },
  decoLabel: { fontSize: 12.5, color: Colors.gray500 },
});
