import { Ionicons } from '@expo/vector-icons';
import { todayInTimeZone } from '@alora/shared';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { OfflineBanner } from '@/components/offline-banner';
import { Avatar, Card, ErrorText, GradientHeader, Pill, colors, shadow, styles } from '@/components/ui';
import { errorMessage, useAuth } from '@/lib/auth-context';
import { useOffline } from '@/lib/offline';
import { effectiveStatus } from '@/lib/offline-queue';
import { greeting, humanize, longDate, nextVisit, time, type Visit } from '@/lib/visits';

/** Today's visits for the signed-in caregiver, in the agency's timezone (D-043, D-080). */
export default function TodayScreen() {
  const { user } = useAuth();
  const { read, ops } = useOffline();
  const insets = useSafeAreaInsets();
  const [visits, setVisits] = useState<Visit[] | null>(null);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const today = user ? todayInTimeZone(user.agencyTimezone) : null;

  const load = useCallback(async () => {
    if (!today) return;
    setError(null);
    try {
      const { data, stale: fromPhone } = await read<{ date: string; visits: Visit[] }[]>(`/schedule/calendar?from=${today}&to=${today}`);
      setVisits(data[0]?.visits ?? []);
      setStale(fromPhone);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [read, today]);

  useEffect(() => {
    void load();
  }, [load]);

  const withStatus = (visits ?? []).map((v) => ({ ...v, status: effectiveStatus(v.status, v.id, ops) }));
  const done = withStatus.filter((v) => v.status === 'completed').length;
  const next = nextVisit(withStatus);
  const hour = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: user?.agencyTimezone }).format(new Date()));
  const open = (id: string) => router.push({ pathname: '/visit/[id]', params: { id } });

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <FlatList
        data={withStatus}
        keyExtractor={(v) => v.id}
        contentContainerStyle={{ gap: 12, paddingBottom: 32 }}
        refreshControl={
          <RefreshControl
            tintColor={colors.brand}
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
          />
        }
        ListHeaderComponent={
          <View style={{ gap: 16 }}>
            <GradientHeader style={{ paddingTop: insets.top + 16 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: '#9aeedd', fontSize: 14, fontWeight: '600' }}>{today ? longDate(today) : ''}</Text>
                  <Text style={{ color: colors.white, fontSize: 26, fontWeight: '800', marginTop: 2 }}>
                    {greeting(hour)}, {user?.firstName}
                  </Text>
                </View>
                {user && (
                  <Pressable accessibilityRole="button" accessibilityLabel="Profile" onPress={() => router.push('/profile')}>
                    <Avatar first={user.firstName} last={user.lastName} size={46} />
                  </Pressable>
                )}
              </View>
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 20 }}>
                <Stat label="Visits today" value={visits ? String(visits.length) : '…'} />
                <Stat label="Completed" value={visits ? String(done) : '…'} />
                <Stat label="Next" value={next ? time(next.scheduledStart) : '—'} />
              </View>
            </GradientHeader>
            <View style={{ paddingHorizontal: 20, gap: 12 }}>
              <OfflineBanner stale={stale} />
              <ErrorText>{error}</ErrorText>
              {next && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${next.status === 'in_progress' ? 'Current visit' : 'Up next'}: ${time(next.scheduledStart)}, ${next.patient.firstName} ${next.patient.lastName}`}
                  onPress={() => open(next.id)}
                  style={({ pressed }) => pressed && { opacity: 0.85 }}
                >
                  <View style={[{ backgroundColor: colors.brand, borderRadius: 22, padding: 18, gap: 6 }, shadow]}>
                    <Text style={{ color: '#9aeedd', fontWeight: '700', fontSize: 13, letterSpacing: 0.6 }}>
                      {next.status === 'in_progress' ? 'YOU ARE ON THIS VISIT' : 'UP NEXT'}
                    </Text>
                    <Text style={{ color: colors.white, fontSize: 20, fontWeight: '800' }}>
                      {next.patient.firstName} {next.patient.lastName}
                    </Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Ionicons name="time-outline" size={16} color="#ede9fe" />
                      <Text style={{ color: '#ccf7ee', fontSize: 15 }}>
                        {time(next.scheduledStart)} – {time(next.scheduledEnd)} · {humanize(next.visitType)}
                      </Text>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 }}>
                      <Text style={{ color: colors.white, fontWeight: '700', fontSize: 15 }}>
                        {next.status === 'in_progress' ? 'Open visit' : 'Open visit to clock in'}
                      </Text>
                      <Ionicons name="arrow-forward" size={16} color={colors.white} />
                    </View>
                  </View>
                </Pressable>
              )}
              <Text style={styles.sectionTitle}>Today&apos;s visits</Text>
            </View>
          </View>
        }
        ListEmptyComponent={
          visits ? (
            <Card style={{ marginHorizontal: 20, alignItems: 'center', paddingVertical: 28, gap: 8 }}>
              <Ionicons name="sunny-outline" size={34} color={colors.brand} />
              <Text style={{ fontSize: 17, fontWeight: '700', color: colors.text }}>No visits today</Text>
              <Text style={styles.subtitle}>Enjoy the day — check Schedule for what&apos;s coming.</Text>
            </Card>
          ) : null
        }
        renderItem={({ item }) => (
          <Pressable
            style={({ pressed }) => [{ marginHorizontal: 20 }, pressed && { opacity: 0.75 }]}
            accessibilityRole="button"
            accessibilityLabel={`${time(item.scheduledStart)} ${item.patient.firstName} ${item.patient.lastName}, ${humanize(item.status)}`}
            onPress={() => open(item.id)}
          >
            <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
              <View style={{ alignItems: 'center', width: 64, paddingVertical: 6, borderRadius: 14, backgroundColor: colors.brandSoft }}>
                <Text style={{ fontSize: 15, fontWeight: '800', color: colors.brandDark }}>{time(item.scheduledStart).replace(/ (AM|PM)/, '')}</Text>
                <Text style={{ fontSize: 12, fontWeight: '700', color: colors.brand }}>{time(item.scheduledStart).slice(-2)}</Text>
              </View>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={{ fontSize: 17, fontWeight: '700', color: colors.text }}>
                  {item.patient.firstName} {item.patient.lastName}
                </Text>
                <Text style={{ color: colors.muted, fontSize: 14 }}>
                  {humanize(item.visitType)} · until {time(item.scheduledEnd)}
                </Text>
                <Pill status={item.status} />
              </View>
              <Ionicons name="chevron-forward" size={20} color="#94a3b8" />
            </Card>
          </Pressable>
        )}
      />
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1, backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 16, paddingVertical: 12, paddingHorizontal: 12 }}>
      <Text style={{ color: colors.white, fontSize: 20, fontWeight: '800' }}>{value}</Text>
      <Text style={{ color: '#9aeedd', fontSize: 12, fontWeight: '600', marginTop: 2 }}>{label}</Text>
    </View>
  );
}
