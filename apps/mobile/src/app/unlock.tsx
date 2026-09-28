import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { Button, ErrorText, styles } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';

/**
 * Locked (relaunch, or 5+ minutes in the background): Face ID / fingerprint / device passcode to continue.
 * Nothing about patients is shown until unlocked.
 */
export default function UnlockScreen() {
  const { unlock, signOut } = useAuth();
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
    <View style={styles.center}>
      <Text style={[styles.title, { textAlign: 'center' }]}>Alora is locked</Text>
      <Text style={[styles.subtitle, { textAlign: 'center', marginBottom: 24 }]}>
        Unlock with Face ID, fingerprint or your phone passcode.
      </Text>
      <ErrorText>{error}</ErrorText>
      <Button title="Unlock" onPress={() => void tryUnlock()} busy={busy} />
      <Button title="Sign out" variant="secondary" onPress={() => void signOut()} />
    </View>
  );
}
