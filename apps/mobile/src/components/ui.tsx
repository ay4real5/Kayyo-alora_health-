import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import type { ComponentProps, ReactNode } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';

/** Primordial Health palette (D-079/D-080): indigo & violet, like the dashboard. */
export const colors = {
  brand: '#6d28d9',
  brandDark: '#5b21b6',
  brandSoft: '#ede9fe',
  ink: '#1e1b4b',
  indigo: '#312e81',
  text: '#0f172a',
  muted: '#5b6477',
  border: '#e2e8f0',
  danger: '#be123c',
  dangerBg: '#fff1f2',
  success: '#047857',
  successBg: '#ecfdf5',
  warning: '#92400e',
  warningBg: '#fffbeb',
  bg: '#f5f5fa',
  white: '#ffffff',
};

export type IconName = ComponentProps<typeof Ionicons>['name'];

/** Soft card shadow on both platforms. */
export const shadow: ViewStyle = Platform.select({
  ios: { shadowColor: '#1e1b4b', shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
  default: { elevation: 2 },
}) as ViewStyle;

/** Large, high-contrast controls: caregivers use the app one-handed, often outdoors. */
export function Button({
  title,
  onPress,
  busy,
  variant = 'primary',
  icon,
}: {
  title: string;
  onPress(): void;
  busy?: boolean;
  variant?: 'primary' | 'secondary' | 'danger';
  icon?: IconName;
}) {
  const primary = variant === 'primary';
  const fg = primary ? colors.white : variant === 'danger' ? colors.danger : colors.brand;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ busy: Boolean(busy), disabled: Boolean(busy) }}
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        primary ? [styles.primary, shadow] : variant === 'danger' ? styles.dangerButton : styles.secondary,
        pressed && { opacity: 0.85, transform: [{ scale: 0.99 }] },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={fg} />
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {icon && <Ionicons name={icon} size={20} color={fg} />}
          <Text style={[styles.buttonText, { color: fg }]}>{title}</Text>
        </View>
      )}
    </Pressable>
  );
}

export function Input({ label, ...props }: TextInputProps & { label: string }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput accessibilityLabel={label} placeholderTextColor="#8a93a6" style={styles.input} {...props} />
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

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, shadow, style]}>{children}</View>;
}

const PILL: Record<string, [string, string]> = {
  scheduled: ['#ede9fe', '#5b21b6'],
  in_progress: ['#e0e7ff', '#3730a3'],
  completed: ['#ecfdf5', '#047857'],
  missed: ['#fff1f2', '#be123c'],
  cancelled: ['#f1f5f9', '#475569'],
};

/** Coloured status label. */
export function Pill({ status, label }: { status: string; label?: string }) {
  const [bg, fg] = PILL[status] ?? ['#f1f5f9', '#475569'];
  return (
    <View style={{ backgroundColor: bg, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start' }}>
      <Text style={{ color: fg, fontSize: 13, fontWeight: '600' }}>{label ?? status.charAt(0).toUpperCase() + status.slice(1).replaceAll('_', ' ')}</Text>
    </View>
  );
}

/** Round initials badge. */
export function Avatar({ first, last, size = 44 }: { first: string; last: string; size?: number }) {
  return (
    <LinearGradient
      colors={['#8b5cf6', '#c026d3']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{ width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center' }}
    >
      <Text style={{ color: colors.white, fontWeight: '700', fontSize: size * 0.38 }}>
        {`${first.charAt(0)}${last.charAt(0)}`.toUpperCase()}
      </Text>
    </LinearGradient>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

/** A settings-style row: icon, label, optional value, and a chevron when it opens something. */
export function ListRow({
  icon,
  label,
  value,
  onPress,
  tone = 'default',
  last,
  right,
}: {
  icon: IconName;
  label: string;
  value?: string | null;
  onPress?(): void;
  tone?: 'default' | 'danger';
  last?: boolean;
  right?: ReactNode;
}) {
  const color = tone === 'danger' ? colors.danger : colors.text;
  const body = (
    <View style={[styles.row, !last && styles.rowDivider]}>
      <View style={[styles.rowIcon, tone === 'danger' && { backgroundColor: colors.dangerBg }]}>
        <Ionicons name={icon} size={18} color={tone === 'danger' ? colors.danger : colors.brand} />
      </View>
      <Text style={[styles.rowLabel, { color }]}>{label}</Text>
      {value ? (
        <Text style={styles.rowValue} numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      {right}
      {onPress && <Ionicons name="chevron-forward" size={18} color="#94a3b8" />}
    </View>
  );
  return onPress ? (
    <Pressable accessibilityRole="button" accessibilityLabel={value ? `${label}, ${value}` : label} onPress={onPress} style={({ pressed }) => pressed && { opacity: 0.6 }}>
      {body}
    </Pressable>
  ) : (
    <View accessible accessibilityLabel={value ? `${label}, ${value}` : label}>
      {body}
    </View>
  );
}

/** The indigo → violet header band used at the top of the main tabs. */
export function GradientHeader({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <LinearGradient colors={['#1e1b4b', '#312e81', '#6d28d9']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.header, style]}>
      {children}
    </LinearGradient>
  );
}

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, padding: 20, gap: 16 },
  center: { flex: 1, backgroundColor: colors.bg, padding: 24, gap: 16, justifyContent: 'center' },
  title: { fontSize: 28, fontWeight: '800', color: colors.ink, letterSpacing: -0.3 },
  subtitle: { fontSize: 16, color: colors.muted },
  label: { fontSize: 15, fontWeight: '600', color: colors.text },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 17,
    backgroundColor: colors.white,
    color: colors.text,
  },
  button: { borderRadius: 16, paddingVertical: 15, alignItems: 'center', minHeight: 54, justifyContent: 'center', paddingHorizontal: 16 },
  primary: { backgroundColor: colors.brand },
  secondary: { backgroundColor: colors.white, borderWidth: 1, borderColor: '#ddd6fe' },
  dangerButton: { backgroundColor: colors.dangerBg, borderWidth: 1, borderColor: '#fecdd3' },
  buttonText: { fontSize: 17, fontWeight: '700' },
  error: { color: colors.danger, backgroundColor: colors.dangerBg, padding: 12, borderRadius: 12, fontSize: 15 },
  card: { backgroundColor: colors.white, borderRadius: 20, padding: 16, gap: 4 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 8, marginLeft: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, minHeight: 52 },
  rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  rowIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: colors.brandSoft, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { flex: 1, fontSize: 16, fontWeight: '500' },
  rowValue: { fontSize: 15, color: colors.muted, maxWidth: '45%' },
  header: { paddingHorizontal: 20, paddingBottom: 24, borderBottomLeftRadius: 28, borderBottomRightRadius: 28 },
});

/** The Primordial Health tile: a violet square with a P. */
export function BrandMark({ size = 56 }: { size?: number }) {
  return (
    <LinearGradient
      colors={['#8b5cf6', '#4f46e5']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{ width: size, height: size, borderRadius: size * 0.3, alignItems: 'center', justifyContent: 'center' }}
    >
      <Text style={{ color: colors.white, fontSize: size * 0.45, fontWeight: '800' }}>P</Text>
    </LinearGradient>
  );
}
