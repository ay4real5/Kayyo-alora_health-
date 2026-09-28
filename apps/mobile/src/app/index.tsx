import { todayInTimeZone } from '@alora/shared';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';
import { Button, ErrorText, colors, styles } from '@/components/ui';
import { errorMessage, useAuth } from '@/lib/auth-context';

interface Visit {
  id: string;
  patient: { firstName: string; lastName: string };
  visitType: string;
  status: string;
  scheduledStart: string;
  scheduledEnd: string;
}

function time(hhmm: string): string {
  const [h = 0, m = 0] = hhmm.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

const humanize = (code: string) => code.charAt(0).toUpperCase() + code.slice(1).replaceAll('_', ' ');

/** Today's visits for the signed-in caregiver, in the agency's timezone. Visit detail and clock-in come in P2-07. */
export default function TodayScreen() {
  const { user, request, signOut } = useAuth();
  const [visits, setVisits] = useState<Visit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const today = user ? todayInTimeZone(user.agencyTimezone) : null;

  const load = useCallback(async () => {
    if (!today) return;
    setError(null);
    try {
      const { data } = await request<{ date: string; visits: Visit[] }[]>(`/schedule/calendar?from=${today}&to=${today}`);
      setVisits(data[0]?.visits ?? []);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [request, today]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <View style={[styles.screen, { paddingBottom: 0 }]}>
      <Text style={styles.subtitle}>
        Hi {user?.firstName}. {visits ? `${visits.length} visit${visits.length === 1 ? '' : 's'} today.` : 'Loading…'}
      </Text>
      <ErrorText>{error}</ErrorText>
      <FlatList
        data={visits ?? []}
        keyExtractor={(v) => v.id}
        contentContainerStyle={{ gap: 12, paddingBottom: 24 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
          />
        }
        ListEmptyComponent={visits ? <Text style={styles.subtitle}>No visits today.</Text> : null}
        renderItem={({ item }) => (
          <View style={styles.card} accessible accessibilityLabel={`${time(item.scheduledStart)} ${item.patient.firstName} ${item.patient.lastName}`}>
            <Text style={{ fontSize: 17, fontWeight: '700', color: colors.text }}>
              {time(item.scheduledStart)} – {time(item.scheduledEnd)}
            </Text>
            <Text style={{ fontSize: 17, color: colors.text }}>
              {item.patient.firstName} {item.patient.lastName}
            </Text>
            <Text style={{ color: colors.muted }}>
              {humanize(item.visitType)} · {humanize(item.status)}
            </Text>
          </View>
        )}
        ListFooterComponent={<Button title="Sign out" variant="secondary" onPress={() => void signOut()} />}
      />
    </View>
  );
}
