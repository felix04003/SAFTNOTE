// app/(app)/enseignant/_layout.tsx
import { Tabs }     from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Typography } from '../../../src/utils/theme';

const TABS = [
  { name: 'index',        titre: 'Accueil', icone: 'home'             },
  { name: 'appel',        titre: 'Appel',   icone: 'checkmark-circle' },
  { name: 'evaluations',  titre: 'Évals',   icone: 'bar-chart'        },
];
// notes-saisie a besoin d'un evaluation_id (matière/classe/barème) pour être
// utile — il n'y a pas de "notes du jour" par défaut comme pour l'appel.
// En onglet direct, il s'affichait avec des paramètres undefined (voir
// audit VANGUARD). Seul chemin d'accès désormais : evaluations.tsx → tap
// sur une évaluation → push avec les params.
const HIDDEN = ['classes', 'moyennes', 'notes-saisie'];

export default function EnseignantLayout() {
  return (
    <Tabs
      screenOptions={({ route }) => {
        const tab    = TABS.find(t => t.name === route.name);
        const hidden = HIDDEN.includes(route.name);
        return {
          headerShown: false,
          href: hidden ? null : undefined,
          tabBarActiveTintColor:   Colors.primary,
          tabBarInactiveTintColor: Colors.gray400,
          tabBarStyle: {
            backgroundColor: Colors.white,
            borderTopColor:  Colors.gray200,
            borderTopWidth:  1,
            paddingBottom:   8,
            paddingTop:      6,
            height:          60,
          },
          tabBarLabelStyle: { fontSize: Typography.xs, fontWeight: '600' as const },
          tabBarIcon: ({ color, size, focused }) => {
            const icone = (tab?.icone || 'home') + (focused ? '' : '-outline');
            return <Ionicons name={icone as any} size={size} color={color} />;
          },
          tabBarLabel: tab?.titre || '',
        };
      }}
    >
      <Tabs.Screen name="classes"   options={{ href: null }} />
      <Tabs.Screen name="moyennes"  options={{ href: null }} />
    </Tabs>
  );
}
