// app/auth/connexion.tsx
import React, { useState, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useRouter }       from 'expo-router';
import { Ionicons }        from '@expo/vector-icons';
import { SafeAreaView }    from 'react-native-safe-area-context';
import { useAuthStore }    from '../../src/stores/authStore';
import { authApi }         from '../../src/services/api/client';
import { Colors, Typography, Spacing, Radius, Shadow } from '../../src/utils/theme';
import Bouton               from '../../src/components/ui/Bouton';

type Mode = 'mdp' | 'otp_demander' | 'otp_valider';

const PAYS = [
  { code: 'SN', label: 'Sénégal',       prefixe: '+221' },
  { code: 'CI', label: "Côte d'Ivoire", prefixe: '+225' },
  { code: 'ML', label: 'Mali',           prefixe: '+223' },
  { code: 'BF', label: 'Burkina Faso',  prefixe: '+226' },
  { code: 'GN', label: 'Guinée',         prefixe: '+224' },
  { code: 'CM', label: 'Cameroun',       prefixe: '+237' },
] as const;

export default function ConnexionScreen() {
  const router = useRouter();
  const connexionMDP = useAuthStore(s => s.connexionMDP);
  const connexionOTP = useAuthStore(s => s.connexionOTP);

  const [mode, setMode]         = useState<Mode>('mdp');
  const [loading, setLoading]   = useState(false);
  const [erreur, setErreur]     = useState('');
  const [etablissement, setEtablissement] = useState('');
  const [identifiant,   setIdentifiant]   = useState('');
  const [motDePasse,    setMotDePasse]    = useState('');
  const [voirMDP,       setVoirMDP]       = useState(false);
  const [pays,      setPays]       = useState<typeof PAYS[number]>(PAYS[0]);
  const [telephone, setTelephone] = useState('');
  const [otp,       setOtp]       = useState('');
  const otpRefs = useRef<(TextInput | null)[]>([null, null, null, null, null, null]);

  const clearErr = () => setErreur('');

  async function handleConnexionMDP() {
    if (!etablissement.trim() || !identifiant.trim() || !motDePasse.trim()) {
      return setErreur('Tous les champs sont requis');
    }
    setLoading(true); clearErr();
    try {
      await connexionMDP({ identifiant: identifiant.trim(), mot_de_passe: motDePasse, etablissement_code: etablissement.trim().toUpperCase() });
      router.replace('/(app)');
    } catch (err: any) { setErreur(err.message || 'Identifiants incorrects'); }
    finally { setLoading(false); }
  }

  async function handleDemanderOTP() {
    if (!etablissement.trim() || !telephone.trim()) return setErreur('Établissement et téléphone requis');
    setLoading(true); clearErr();
    try {
      await authApi.demanderOTP({ telephone: telephone.trim().startsWith('+') ? telephone.trim() : pays.prefixe + telephone.trim(), etablissement_code: etablissement.trim().toUpperCase() });
      setMode('otp_valider');
    } catch (err: any) { setErreur(err.message || 'Impossible d\'envoyer le code'); }
    finally { setLoading(false); }
  }

  async function handleValiderOTP() {
    if (otp.length !== 6) return setErreur('Entrez les 6 chiffres du code');
    setLoading(true); clearErr();
    try {
      await connexionOTP({ telephone: telephone.trim().startsWith('+') ? telephone.trim() : pays.prefixe + telephone.trim(), code: otp, etablissement_code: etablissement.trim().toUpperCase() });
      router.replace('/(app)');
    } catch (err: any) { setErreur(err.message || 'Code incorrect ou expiré'); setOtp(''); }
    finally { setLoading(false); }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={styles.hero}>
            <View style={styles.logoContainer}><Ionicons name="school" size={52} color={Colors.white} /></View>
            <Text style={styles.appName}>EcoleManager</Text>
            <Text style={styles.tagline}>Afrique de l'Ouest · Systèmes Francophones</Text>
          </View>

          <View style={[styles.carte, Shadow.lg]}>
            <Text style={styles.label}>Code établissement</Text>
            <View style={styles.inputContainer}>
              <Ionicons name="business-outline" size={18} color={Colors.gray400} style={styles.inputIcon} />
              <TextInput style={styles.input} placeholder="Ex: LYCEE-DAKAR-01" placeholderTextColor={Colors.gray400} value={etablissement} onChangeText={t => { setEtablissement(t.toUpperCase()); clearErr(); }} autoCapitalize="characters" autoCorrect={false} />
            </View>

            <View style={styles.onglets}>
              {([['mdp', 'lock-closed-outline', 'Mot de passe'], ['otp_demander', 'phone-portrait-outline', 'Code SMS (Parents)']] as const).map(([m, icon, lbl]) => (
                <TouchableOpacity key={m} style={[styles.onglet, mode === m && styles.ongletActif]} onPress={() => { setMode(m as Mode); clearErr(); }}>
                  <Ionicons name={icon as any} size={14} color={mode === m ? Colors.primary : Colors.gray400} />
                  <Text style={[styles.ongletLabel, mode === m && styles.ongletLabelActif]}>{lbl}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {mode === 'mdp' && (
              <>
                <Text style={styles.label}>Email ou téléphone</Text>
                <View style={styles.inputContainer}>
                  <Ionicons name="person-outline" size={18} color={Colors.gray400} style={styles.inputIcon} />
                  <TextInput style={styles.input} placeholder="email@exemple.com" placeholderTextColor={Colors.gray400} value={identifiant} onChangeText={t => { setIdentifiant(t); clearErr(); }} autoCapitalize="none" keyboardType="email-address" />
                </View>
                <Text style={styles.label}>Mot de passe</Text>
                <View style={styles.inputContainer}>
                  <Ionicons name="key-outline" size={18} color={Colors.gray400} style={styles.inputIcon} />
                  <TextInput style={[styles.input, { flex: 1 }]} placeholder="Votre mot de passe" placeholderTextColor={Colors.gray400} value={motDePasse} onChangeText={t => { setMotDePasse(t); clearErr(); }} secureTextEntry={!voirMDP} />
                  <TouchableOpacity onPress={() => setVoirMDP(!voirMDP)} style={styles.oeilBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}><Ionicons name={voirMDP ? 'eye-off-outline' : 'eye-outline'} size={18} color={Colors.gray400} /></TouchableOpacity>
                </View>
                <Bouton label="Se connecter" onPress={handleConnexionMDP} chargement={loading} pleineLargeur style={styles.boutonPrincipal} />
              </>
            )}

            {mode === 'otp_demander' && (
              <>
                <Text style={styles.infoText}>Vous recevrez un code à 6 chiffres par SMS sur votre numéro enregistré.</Text>
                <Text style={styles.label}>Numéro de téléphone</Text>
                <View style={styles.inputContainer}>
                  <TouchableOpacity
                    style={styles.paysSelector}
                    onPress={() => {
                      const idx = PAYS.findIndex(p => p.code === pays.code);
                      setPays(PAYS[(idx + 1) % PAYS.length]);
                    }}>
                    <Text style={styles.prefixe}>{pays.prefixe}</Text>
                    <Ionicons name="chevron-down" size={12} color={Colors.gray500} />
                  </TouchableOpacity>
                  <TextInput style={[styles.input, { flex: 1 }]} placeholder="77 000 00 00" placeholderTextColor={Colors.gray400} value={telephone} onChangeText={t => { setTelephone(t.replace(/\D/g, '')); clearErr(); }} keyboardType="phone-pad" maxLength={9} />
                </View>
                <Bouton label="Recevoir le code SMS" onPress={handleDemanderOTP} chargement={loading} pleineLargeur style={styles.boutonPrincipal} />
              </>
            )}

            {mode === 'otp_valider' && (
              <>
                <View style={styles.successBanner}>
                  <Ionicons name="checkmark-circle" size={20} color={Colors.success} />
                  <Text style={styles.successText}>Code envoyé au {telephone}</Text>
                </View>
                <Text style={styles.label}>Code à 6 chiffres</Text>
                <View style={styles.otpContainer}>
                  {[0,1,2,3,4,5].map(i => (
                    <TextInput key={i} ref={r => otpRefs.current[i] = r} style={[styles.otpInput, otp[i] && styles.otpInputRempli]} keyboardType="number-pad" maxLength={1} value={otp[i] || ''}
                      onChangeText={val => { const d = val.replace(/\D/g,''); const n = otp.slice(0,i)+(d.slice(-1)||'')+otp.slice(i+1); setOtp(n); clearErr(); if(d&&i<5) otpRefs.current[i+1]?.focus(); }}
                      onKeyPress={({nativeEvent}) => { if(nativeEvent.key==='Backspace'&&!otp[i]&&i>0) otpRefs.current[i-1]?.focus(); }} />
                  ))}
                </View>
                <Bouton label="Valider le code" onPress={handleValiderOTP} chargement={loading} desactive={otp.length !== 6} pleineLargeur style={styles.boutonPrincipal} />
                <TouchableOpacity onPress={() => setMode('otp_demander')} style={styles.renvoyerBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}><Text style={styles.renvoyerLabel}>Renvoyer le code</Text></TouchableOpacity>
              </>
            )}

            {erreur !== '' && (
              <View style={styles.erreurContainer}>
                <Ionicons name="alert-circle-outline" size={16} color={Colors.danger} />
                <Text style={styles.erreurText}>{erreur}</Text>
              </View>
            )}
          </View>
          <Text style={styles.footer}>Gestion Scolaire · Afrique de l'Ouest · v1.0</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.primary },
  flex: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: Spacing.md, paddingVertical: Spacing.xl },
  hero: { alignItems: 'center', marginBottom: Spacing.xl },
  logoContainer: { width: 88, height: 88, borderRadius: 44, backgroundColor: Colors.white + '20', alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.md, borderWidth: 2, borderColor: Colors.white + '40' },
  appName: { fontSize: Typography.xxl, fontWeight: Typography.bold, color: Colors.white, letterSpacing: 1 },
  tagline: { fontSize: Typography.xs, color: Colors.white + 'AA', marginTop: 4 },
  carte: { backgroundColor: Colors.white, borderRadius: Radius.lg, padding: Spacing.lg, marginBottom: Spacing.md },
  onglets: { flexDirection: 'row', marginBottom: Spacing.md, gap: 8 },
  onglet: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: Radius.sm, borderWidth: 1.5, borderColor: Colors.gray200, backgroundColor: Colors.gray50 },
  ongletActif: { borderColor: Colors.primary, backgroundColor: Colors.primaryBg },
  ongletLabel: { fontSize: Typography.xs, color: Colors.gray500, fontWeight: Typography.medium },
  ongletLabelActif: { color: Colors.primary },
  label: { fontSize: Typography.sm, fontWeight: Typography.semibold, color: Colors.gray700, marginBottom: 6, marginTop: 12 },
  inputContainer: { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderColor: Colors.gray200, borderRadius: Radius.md, backgroundColor: Colors.gray50, paddingHorizontal: Spacing.sm, height: 50 },
  inputIcon: { marginRight: 8 },
  input: { flex: 1, fontSize: Typography.base, color: Colors.gray900 },
  oeilBtn:      { padding: 6 },
  paysSelector: { flexDirection: 'row', alignItems: 'center', gap: 4, marginRight: 8 },
  prefixe:      { fontSize: Typography.base, color: Colors.gray600, fontWeight: Typography.medium },
  infoText: { fontSize: Typography.sm, color: Colors.gray500, lineHeight: 20, marginVertical: 8 },
  boutonPrincipal: { marginTop: Spacing.lg },
  otpContainer: { flexDirection: 'row', gap: 10, justifyContent: 'center', marginVertical: 8 },
  otpInput: { width: 46, height: 56, borderWidth: 2, borderColor: Colors.gray200, borderRadius: Radius.md, textAlign: 'center', fontSize: Typography.xl, fontWeight: Typography.bold, color: Colors.gray900, backgroundColor: Colors.gray50 },
  otpInputRempli: { borderColor: Colors.primary, backgroundColor: Colors.primaryBg },
  renvoyerBtn: { alignItems: 'center', marginTop: 14 },
  renvoyerLabel: { fontSize: Typography.sm, color: Colors.accent, fontWeight: Typography.medium },
  successBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: Colors.successLight, borderRadius: Radius.sm, padding: Spacing.sm, marginBottom: 4 },
  successText: { fontSize: Typography.sm, color: Colors.success, fontWeight: Typography.medium },
  erreurContainer: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.dangerLight, borderRadius: Radius.sm, padding: Spacing.sm, marginTop: Spacing.sm },
  erreurText: { fontSize: Typography.sm, color: Colors.danger, flex: 1 },
  footer: { textAlign: 'center', fontSize: Typography.xs, color: Colors.white + '66', marginTop: Spacing.sm },
});
