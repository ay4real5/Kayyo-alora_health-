import { useEffect, useRef, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Text, View } from 'react-native';
import { Button, ErrorText, GradientHeader, colors } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { useOffline } from '@/lib/offline';

/**
 * Locked (relaunch, or 5+ minutes in the background): Face ID / fingerprint / device passcode to continue.
 * Nothing about patients is shown until unlocked.
 */
export default function UnlockScreen() {
  const { unlock } = useAuth();
  const { signOut } = useOffline();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const prompted = useRef(false);

  const tryUnlock = async () => {
    setBusy(true);
    setError(await unlock());
    setBusy(false);
  };

  // Prompt once on arrival; afterwards the button retries.
  useEffect(() => {
    if (prompted.current) return;
    prompted.current = true;
    void tryUnlock();
  });

  return (
    <GradientHeader style={{ flex: 1, justifyContent: 'center', padding: 28, gap: 16, borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }}>
      <View style={{ alignItems: 'center', gap: 14, marginBottom: 20 }}>
        <View style={{ width: 88, height: 88, borderRadius: 44, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="lock-closed" size={38} color={colors.white} />
        </View>
        <Text style={{ color: colors.white, fontSize: 26, fontWeight: '800', textAlign: 'center' }}>Primordial Health is locked</Text>
        <Text style={{ color: '#c7d2fe', fontSize: 16, textAlign: 'center' }}>
          Unlock with Face ID, fingerprint or your phone passcode.
        </Text>
      </View>
      <ErrorText>{error}</ErrorText>
      <Button title="Unlock" icon="finger-print" onPress={() => void tryUnlock()} busy={busy} />
      <Button title="Sign out" variant="secondary" onPress={signOut} />
    </GradientHeader>
  );
}
