// app/(app)/enseignant/_layout.tsx
import { Tabs }     from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors }   from '../../../src/utils/theme';

const TABS = [
  { name: 'index',        titre: 'Accueil', icone: 'home'             },
  { name: 'appel',        titre: 'Appel',   icone: 'checkmark-circle' },
  { name: 'notes-saisie', titre: 'Notes',   icone: 'create'           },
  { name: 'evaluations',  titre: 'Évals',   icone: 'bar-chart'        },
];
const HIDDEN = ['classes', 'moyennes', 'bulletins'];

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
          tabBarLabelStyle: { fontSize: 10, fontWeight: '600' as const },
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
      <Tabs.Screen name="bulletins" options={{ href: null }} />
    </Tabs>
  );
}
