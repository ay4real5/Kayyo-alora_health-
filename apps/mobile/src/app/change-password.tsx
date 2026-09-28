import { checkPassword } from '@alora/shared';
import { useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { Button, ErrorText, Input, styles } from '@/components/ui';
import { errorMessage, useAuth } from '@/lib/auth-context';
import { useOffline } from '@/lib/offline';
import type { Tokens } from '@/lib/session';

/** Shown when the password was set by an administrator or has expired. */
export default function ChangePasswordScreen() {
  const { request, passwordChanged } = useAuth();
  const { signOut } = useOffline();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const problems = next ? checkPassword(next).problems : [];

  const submit = async () => {
    if (next !== confirm) return setError('The new passwords do not match.');
    if (problems.length) return setError(problems.join(' '));
    setBusy(true);
    setError(null);
    try {
      const { data } = await request<Tokens>('/auth/change-password', {
        method: 'POST',
        body: { currentPassword: current, newPassword: next },
      });
      await passwordChanged(data);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
      <Text style={styles.subtitle}>Your password was set by an administrator or has expired. Choose a new one.</Text>
      <ErrorText>{error}</ErrorText>
      <Input label="Current password" value={current} onChangeText={setCurrent} secureTextEntry />
      <Input label="New password" value={next} onChangeText={setNext} secureTextEntry textContentType="newPassword" />
      {problems.map((p) => (
        <Text key={p} style={{ color: '#92400e' }}>
          • {p}
        </Text>
      ))}
      <Input label="Confirm new password" value={confirm} onChangeText={setConfirm} secureTextEntry />
      <Button title="Change password" onPress={() => void submit()} busy={busy} />
      <Button title="Sign out" variant="secondary" onPress={signOut} />
    </ScrollView>
  );
}
