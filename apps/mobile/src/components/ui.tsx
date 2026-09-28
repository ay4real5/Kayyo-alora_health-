import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';

export const colors = {
  brand: '#0f766e',
  brandDark: '#115e59',
  text: '#0f172a',
  muted: '#475569',
  border: '#cbd5e1',
  danger: '#b91c1c',
  dangerBg: '#fef2f2',
  bg: '#f8fafc',
  white: '#ffffff',
};

/** Large, high-contrast controls: caregivers use the app one-handed, often outdoors. */
export function Button({
  title,
  onPress,
  busy,
  variant = 'primary',
}: {
  title: string;
  onPress(): void;
  busy?: boolean;
  variant?: 'primary' | 'secondary';
}) {
  const primary = variant === 'primary';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ busy: Boolean(busy), disabled: Boolean(busy) }}
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        primary ? styles.primary : styles.secondary,
        pressed && { opacity: 0.8 },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={primary ? colors.white : colors.brand} />
      ) : (
        <Text style={[styles.buttonText, { color: primary ? colors.white : colors.brand }]}>{title}</Text>
      )}
    </Pressable>
  );
}

export function Input({ label, ...props }: TextInputProps & { label: string }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput accessibilityLabel={label} placeholderTextColor="#94a3b8" style={styles.input} {...props} />
    </View>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <Text accessibilityRole="alert" style={styles.error}>
      {children}
    </Text>
  );
}

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, padding: 24, gap: 16 },
  center: { flex: 1, backgroundColor: colors.bg, padding: 24, gap: 16, justifyContent: 'center' },
  title: { fontSize: 26, fontWeight: '700', color: colors.text },
  subtitle: { fontSize: 16, color: colors.muted },
  label: { fontSize: 15, fontWeight: '600', color: colors.text },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 17,
    backgroundColor: colors.white,
    color: colors.text,
  },
  button: { borderRadius: 10, paddingVertical: 14, alignItems: 'center', minHeight: 50, justifyContent: 'center' },
  primary: { backgroundColor: colors.brand },
  secondary: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.brand },
  buttonText: { fontSize: 17, fontWeight: '600' },
  error: { color: colors.danger, backgroundColor: colors.dangerBg, padding: 12, borderRadius: 8, fontSize: 15 },
  card: { backgroundColor: colors.white, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: '#e2e8f0', gap: 4 },
});
