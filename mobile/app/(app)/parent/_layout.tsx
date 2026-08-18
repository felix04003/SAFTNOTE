// app/(app)/parent/_layout.tsx
import { Tabs }     from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Typography } from '../../../src/utils/theme';

const ONGLETS = [
  { name: 'index',    titre: 'Accueil',   icone: 'home'           },
  { name: 'notes',    titre: 'Notes',     icone: 'school'         },
  { name: 'absences', titre: 'Absences',  icone: 'calendar'       },
  { name: 'bulletins',titre: 'Bulletins', icone: 'document-text'  },
  { name: 'profil',   titre: 'Profil',    icone: 'person-circle'  },
];

export default function ParentLayout() {
  return (
    <Tabs
      screenOptions={({ route }) => ({
        headerShown:           false,
        tabBarActiveTintColor: Colors.primary,
        tabBarInactiveTintColor: Colors.gray400,
        tabBarStyle: {
          backgroundColor: Colors.white,
          borderTopColor:  Colors.gray200,
          paddingBottom:   8, paddingTop: 6, height: 60,
        },
        tabBarLabelStyle: { fontSize: Typography.xs, fontWeight: '600' },
        tabBarIcon: ({ color, size, focused }) => {
          const o = ONGLETS.find(o => o.name === route.name);
          return <Ionicons name={(o?.icone || 'home') + (focused ? '' : '-outline') as any} size={size} color={color} />;
        },
        tabBarLabel: ONGLETS.find(o => o.name === route.name)?.titre || '',
      })}
    />
  );
}
