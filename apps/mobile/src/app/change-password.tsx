import { checkPassword } from '@alora/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, Text } from 'react-native';
import { Button, ErrorText, Input, styles } from '@/components/ui';
import { errorMessage, useAuth } from '@/lib/auth-context';
import { useOffline } from '@/lib/offline';
import type { Tokens } from '@/lib/session';

/** Shown when the password was set by an administrator or has expired. */
export default function ChangePasswordScreen() {
  return <ChangePasswordForm required />;
}

/** The form: forced (`required`, before anything else) or chosen from Profile → Change password. */
export function ChangePasswordForm({ required }: { required: boolean }) {
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
      if (!required) {
        Alert.alert('Password changed', 'You were signed out on your other devices.');
        router.back();
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
      <Text style={styles.subtitle}>
        {required
          ? 'Your password was set by an administrator or has expired. Choose a new one.'
          : 'Choose a new password. You stay signed in here; other devices are signed out.'}
      </Text>
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
      {required && <Button title="Sign out" variant="secondary" onPress={signOut} />}
    </ScrollView>
  );
}
