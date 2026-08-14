// app/index.tsx — écran de chargement initial
// La redirection auth est gérée dans _layout.tsx via useRootNavigationState
import { View, ActivityIndicator } from 'react-native';
import { Colors } from '../src/utils/theme';

export default function Index() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.background }}>
      <ActivityIndicator color={Colors.primary} size="large" />
    </View>
  );
}
