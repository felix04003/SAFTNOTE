// app/(app)/enseignant/_layout.tsx
import { Tabs }       from 'expo-router';
import { Ionicons }   from '@expo/vector-icons';
import { Colors } from '../../../src/utils/theme';

const ONGLETS = [
  { name: 'index',       titre: 'Accueil',     icone: 'home'          },
  { name: 'classes',     titre: 'Classes',     icone: 'people'        },
  { name: 'evaluations', titre: 'Évaluations', icone: 'pencil'        },
  { name: 'calendrier',  titre: 'Calendrier',  icone: 'calendar'      },
  { name: 'profil',      titre: 'Profil',      icone: 'person-circle' },
];

export default function EnseignantLayout() {
  return (
    <Tabs
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor:   Colors.primary,
        tabBarInactiveTintColor: Colors.gray400,
        tabBarStyle: {
          backgroundColor:  Colors.white,
          borderTopColor:   Colors.gray200,
          borderTopWidth:   1,
          paddingBottom:    8,
          paddingTop:       6,
          height:           60,
        },
        tabBarLabelStyle: { fontSize: 10, fontWeight: '600' },
        tabBarIcon: ({ color, size, focused }) => {
          const onglet = ONGLETS.find(o => o.name === route.name);
          const icone  = (onglet?.icone || 'home') + (focused ? '' : '-outline');
          return <Ionicons name={icone as any} size={size} color={color} />;
        },
        tabBarLabel: ONGLETS.find(o => o.name === route.name)?.titre || '',
      })}
    />
  );
}
