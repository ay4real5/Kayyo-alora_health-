import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View } from 'react-native';
import { colors } from '@/components/ui';
import { AuthProvider, useAuth } from '@/lib/auth-context';
import { OfflineProvider } from '@/lib/offline';

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
    <Stack
      screenOptions={{
        headerTintColor: colors.brand,
        headerTitleStyle: { fontWeight: '700', color: colors.ink },
        headerShadowVisible: false,
        headerStyle: { backgroundColor: colors.bg },
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
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
        <Stack.Screen name="(tabs)" options={{ headerShown: false, title: 'Today' }} />
        <Stack.Screen name="password" options={{ title: 'Change password' }} />
        <Stack.Screen name="visit/[id]/index" options={{ title: 'Visit' }} />
        <Stack.Screen name="visit/[id]/tasks" options={{ title: 'Tasks' }} />
        <Stack.Screen name="visit/[id]/vitals" options={{ title: 'Vitals' }} />
        <Stack.Screen name="visit/[id]/note" options={{ title: 'Visit note' }} />
        <Stack.Screen name="messages/[id]" options={{ title: 'Messages' }} />
        <Stack.Screen name="messages/new" options={{ title: 'New message' }} />
        <Stack.Screen name="open-shifts" options={{ title: 'Open shifts' }} />
        <Stack.Screen name="pay" options={{ title: 'My pay' }} />
        <Stack.Screen name="pay/[id]" options={{ title: 'Pay stub' }} />
      </Stack.Protected>
    </Stack>
  );
}

/** Caregiver app root (DECISIONS D-043): each screen is only reachable in the matching session state. */
export default function RootLayout() {
  return (
    <AuthProvider>
      <OfflineProvider>
        <StatusBar style="dark" />
        <Routes />
      </OfflineProvider>
    </AuthProvider>
  );
}
