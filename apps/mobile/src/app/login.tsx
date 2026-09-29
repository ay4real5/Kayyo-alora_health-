import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BrandMark, Button, Card, ErrorText, GradientHeader, Input, colors, styles } from '@/components/ui';
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
  const insets = useSafeAreaInsets();

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
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1 }}>
      <GradientHeader style={{ paddingTop: insets.top + 48, paddingBottom: 72, alignItems: 'center' }}>
        <BrandMark size={64} />
        <Text style={{ color: colors.white, fontSize: 30, fontWeight: '800', marginTop: 16 }}>Primordial Health</Text>
        <Text style={{ color: '#c7d2fe', fontSize: 16, marginTop: 4 }}>Caregiver app</Text>
      </GradientHeader>
      <View style={{ paddingHorizontal: 20, marginTop: -44 }}>
      <Card style={{ padding: 20, gap: 16 }}>
      <Text style={[styles.title, { fontSize: 22 }]}>{twoFactorToken ? 'Two-step verification' : 'Sign in'}</Text>
      <Text style={styles.subtitle}>
        {twoFactorToken ? 'Enter the 6-digit code from your authenticator app.' : 'Use your work email and password.'}
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
      </Card>
      <Text style={{ textAlign: 'center', color: colors.muted, marginTop: 20, fontSize: 13 }}>
        Forgot your password? Ask your office or use the Primordial Health website.
      </Text>
      </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
