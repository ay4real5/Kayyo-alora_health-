import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View } from 'react-native';
import { colors } from '@/components/ui';
import { AuthProvider, useAuth } from '@/lib/auth-context';

function Routes() {
  const { status, mustChangePassword } = useAuth();
  if (status === 'loading') {
    return (
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }
  const signedIn = status === 'signed-in';
  return (
    <Stack screenOptions={{ headerTintColor: colors.brand }}>
      <Stack.Protected guard={status === 'signed-out'}>
        <Stack.Screen name="login" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={status === 'locked'}>
        <Stack.Screen name="unlock" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={signedIn && mustChangePassword}>
        <Stack.Screen name="change-password" options={{ title: 'New password', headerBackVisible: false }} />
      </Stack.Protected>
      <Stack.Protected guard={signedIn && !mustChangePassword}>
        <Stack.Screen name="index" options={{ title: 'Today' }} />
        <Stack.Screen name="visit/[id]" options={{ title: 'Visit' }} />
      </Stack.Protected>
    </Stack>
  );
}

/** Caregiver app root (DECISIONS D-043): each screen is only reachable in the matching session state. */
export default function RootLayout() {
  return (
    <AuthProvider>
      <StatusBar style="dark" />
      <Routes />
    </AuthProvider>
  );
}
