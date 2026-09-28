import { Pressable, Text, View } from 'react-native';
import { useOffline } from '@/lib/offline';
import { colors } from './ui';

const WHAT: Record<string, string> = {
  'clock-in': 'Clock-in',
  'clock-out': 'Clock-out',
  task: 'Task update',
  vitals: 'Vitals',
  note: 'Visit note',
};

/**
 * Tells the caregiver what's saved on the phone and not sent yet, and shows anything the office's system refused
 * (with its reason) until they dismiss it. `stale` marks screens showing the last saved copy.
 */
export function OfflineBanner({ stale }: { stale?: boolean }) {
  const { ops, flush, dismiss } = useOffline();
  const waiting = ops.filter((op) => !op.failure);
  const failed = ops.filter((op) => op.failure);
  if (!waiting.length && !failed.length && !stale) return null;
  return (
    <View style={{ gap: 8 }}>
      {(waiting.length > 0 || stale) && (
        <View accessibilityRole="alert" style={{ backgroundColor: '#fffbeb', borderColor: '#fcd34d', borderWidth: 1, borderRadius: 10, padding: 12, gap: 6 }}>
          <Text style={{ color: '#78350f', fontWeight: '600' }}>
            {stale ? 'Offline — showing what was saved on this phone.' : 'Waiting for a connection.'}
          </Text>
          {waiting.length > 0 && (
            <>
              <Text style={{ color: '#78350f' }}>
                {waiting.length} change{waiting.length === 1 ? '' : 's'} saved on this phone will be sent automatically.
              </Text>
              <Pressable accessibilityRole="button" onPress={() => void flush()}>
                <Text style={{ color: colors.brandDark, fontWeight: '600' }}>Try sending now</Text>
              </Pressable>
            </>
          )}
        </View>
      )}
      {failed.map((op) => (
        <View key={op.id} accessibilityRole="alert" style={{ backgroundColor: colors.dangerBg, borderRadius: 10, padding: 12, gap: 6 }}>
          <Text style={{ color: colors.danger, fontWeight: '600' }}>{WHAT[op.kind]} wasn&apos;t accepted</Text>
          <Text style={{ color: colors.danger }}>{op.failure} — please tell the office.</Text>
          <Pressable accessibilityRole="button" onPress={() => void dismiss(op.id)}>
            <Text style={{ color: colors.danger, textDecorationLine: 'underline' }}>Dismiss</Text>
          </Pressable>
        </View>
      ))}
    </View>
  );
}
