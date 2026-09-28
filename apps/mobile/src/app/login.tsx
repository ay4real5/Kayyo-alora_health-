import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Text } from 'react-native';
import { Button, ErrorText, Input, styles } from '@/components/ui';
import { errorMessage, useAuth } from '@/lib/auth-context';

/** Email + password, then an authenticator code if the account has 2FA on. */
export default function LoginScreen() {
  const { login, verifyTwoFactor } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [twoFactorToken, setTwoFactorToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const outcome = twoFactorToken
        ? await verifyTwoFactor(twoFactorToken, code.trim())
        : await login(email.trim(), password);
      if (outcome.kind === 'two-factor') setTwoFactorToken(outcome.twoFactorToken);
    } catch (e) {
      setError(e instanceof Error && !('status' in e) ? e.message : errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.center}>
      <Text style={styles.title}>Alora</Text>
      <Text style={styles.subtitle}>
        {twoFactorToken ? 'Enter the 6-digit code from your authenticator app.' : 'Sign in with your work account.'}
      </Text>
      <ErrorText>{error}</ErrorText>
      {twoFactorToken ? (
        <Input
          label="Authentication code"
          value={code}
          onChangeText={setCode}
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          maxLength={6}
          autoFocus
        />
      ) : (
        <>
          <Input
            label="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            textContentType="username"
          />
          <Input
            label="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="password"
            textContentType="password"
          />
        </>
      )}
      <Button title={twoFactorToken ? 'Verify' : 'Sign in'} onPress={() => void submit()} busy={busy} />
    </KeyboardAvoidingView>
  );
}
