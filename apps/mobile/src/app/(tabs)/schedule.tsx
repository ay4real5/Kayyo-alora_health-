import { Ionicons } from '@expo/vector-icons';
import { todayInTimeZone } from '@alora/shared';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, SectionList, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { OfflineBanner } from '@/components/offline-banner';
import { Card, ErrorText, GradientHeader, Pill, colors, styles } from '@/components/ui';
import { errorMessage, useAuth } from '@/lib/auth-context';
import { useOffline } from '@/lib/offline';
import { effectiveStatus } from '@/lib/offline-queue';
import { humanize, time, type Visit } from '@/lib/visits';

const DAYS = 7;

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function dayTitle(date: string, today: string): string {
  const label = new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' });
  if (date === today) return `Today · ${label}`;
  if (date === addDays(today, 1)) return `Tomorrow · ${label}`;
  return label;
}

/** The caregiver's next 7 days (D-080). Saved on the phone for offline viewing like Today. */
export default function ScheduleScreen() {
  const { user } = useAuth();
  const { read, ops } = useOffline();
  const insets = useSafeAreaInsets();
  const [days, setDays] = useState<{ date: string; visits: Visit[] }[] | null>(null);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const today = user ? todayInTimeZone(user.agencyTimezone) : null;

  const load = useCallback(async () => {
    if (!today) return;
    setError(null);
    try {
      const { data, stale: fromPhone } = await read<{ date: string; visits: Visit[] }[]>(
        `/schedule/calendar?from=${today}&to=${addDays(today, DAYS - 1)}`,
      );
      setDays(data);
      setStale(fromPhone);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [read, today]);

  useEffect(() => {
    void load();
  }, [load]);

  const sections = (days ?? [])
    .filter((d) => d.visits.length > 0)
    .map((d) => ({ title: today ? dayTitle(d.date, today) : d.date, data: d.visits.map((v) => ({ ...v, status: effectiveStatus(v.status, v.id, ops) })) }));
  const total = sections.reduce((n, s) => n + s.data.length, 0);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <GradientHeader style={{ paddingTop: insets.top + 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <View>
            <Text style={{ color: colors.white, fontSize: 26, fontWeight: '800' }}>Schedule</Text>
            <Text style={{ color: '#9aeedd', fontSize: 15, marginTop: 4 }}>
              {days ? `${total} visit${total === 1 ? '' : 's'} in the next ${DAYS} days` : 'Loading…'}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/open-shifts')}
            style={{ backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, flexDirection: 'row', gap: 6, alignItems: 'center' }}
          >
            <Ionicons name="briefcase-outline" size={18} color={colors.white} />
            <Text style={{ color: colors.white, fontWeight: '700' }}>Open shifts</Text>
          </Pressable>
        </View>
      </GradientHeader>
      <SectionList
        sections={sections}
        keyExtractor={(v) => v.id}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={{ padding: 20, gap: 10, paddingBottom: 32 }}
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
          <View style={{ gap: 12 }}>
            <OfflineBanner stale={stale} />
            <ErrorText>{error}</ErrorText>
          </View>
        }
        ListEmptyComponent={
          days ? (
            <Card style={{ alignItems: 'center', paddingVertical: 28, gap: 8 }}>
              <Ionicons name="calendar-clear-outline" size={34} color={colors.brand} />
              <Text style={{ fontSize: 17, fontWeight: '700', color: colors.text }}>Nothing scheduled</Text>
              <Text style={styles.subtitle}>New visits appear here as the office books them.</Text>
            </Card>
          ) : null
        }
        renderSectionHeader={({ section }) => <Text style={[styles.sectionTitle, { marginTop: 12 }]}>{section.title}</Text>}
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${time(item.scheduledStart)} ${item.patient.firstName} ${item.patient.lastName}, ${humanize(item.status)}`}
            onPress={() => router.push({ pathname: '/visit/[id]', params: { id: item.id } })}
            style={({ pressed }) => pressed && { opacity: 0.75 }}
          >
            <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ width: 4, alignSelf: 'stretch', borderRadius: 4, backgroundColor: item.status === 'completed' ? '#10b981' : colors.brand }} />
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={{ fontSize: 15, fontWeight: '700', color: colors.brandDark }}>
                  {time(item.scheduledStart)} – {time(item.scheduledEnd)}
                </Text>
                <Text style={{ fontSize: 16, fontWeight: '600', color: colors.text }}>
                  {item.patient.firstName} {item.patient.lastName}
                </Text>
                <Text style={{ color: colors.muted, fontSize: 14 }}>{humanize(item.visitType)}</Text>
              </View>
              <Pill status={item.status} />
            </Card>
          </Pressable>
        )}
      />
    </View>
  );
}
