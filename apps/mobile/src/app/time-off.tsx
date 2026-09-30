import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { Button, Card, ErrorText, Input, colors, styles } from '@/components/ui';
import { errorMessage, useAuth } from '@/lib/auth-context';
import { dateRange, shortDate, timeOffCancellable, timeOffError, type TimeOffEntry } from '@/lib/extras';
import { humanize } from '@/lib/visits';

/** The API's TIME_OFF_TYPES (staff module DTO — the shared list differs). */
const TYPES = ['vacation', 'sick', 'personal', 'other'] as const;

/**
 * The caregiver's time-off requests (D-090): ask for days off, see decisions, cancel a request that is pending or
 * hasn't started yet. Supervisors decide on the dashboard.
 */
export default function TimeOffScreen() {
  const { request } = useAuth();
  const [entries, setEntries] = useState<TimeOffEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [type, setType] = useState<(typeof TYPES)[number]>('vacation');
  const [notes, setNotes] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [cancelling, setCancelling] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setEntries((await request<TimeOffEntry[]>('/time-off?limit=50')).data);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [request]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const save = async () => {
    const problem = timeOffError(startDate.trim(), endDate.trim());
    setFormError(problem);
    if (problem || saving) return;
    setSaving(true);
    setFormError(null);
    try {
      const note = notes.trim();
      await request('/time-off', {
        method: 'POST',
        body: { startDate: startDate.trim(), endDate: endDate.trim(), type, ...(note ? { notes: note } : {}) },
      });
      setStartDate('');
      setEndDate('');
      setNotes('');
      await load();
    } catch (e) {
      setFormError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const cancel = async (id: string) => {
    setCancelling(id);
    setError(null);
    try {
      await request(`/time-off/${id}/cancel`, { method: 'POST' });
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setCancelling(null);
    }
  };

  const confirmCancel = (t: TimeOffEntry) =>
    Alert.alert('Cancel this request?', `${dateRange(t.startDate, t.endDate)} · ${humanize(t.type)}`, [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Cancel request', style: 'destructive', onPress: () => void cancel(t.id) },
    ]);

  return (
    <FlatList
      style={{ backgroundColor: colors.bg }}
      data={entries ?? []}
      keyExtractor={(t) => t.id}
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
        <View style={{ gap: 12, marginBottom: 4 }}>
          <Text style={styles.subtitle}>Ask for days off here. The office approves them and you’ll get an alert.</Text>
          <ErrorText>{error}</ErrorText>
          <Card style={{ gap: 12 }}>
            <Input label="First day (YYYY-MM-DD)" value={startDate} onChangeText={setStartDate} placeholder="2026-10-12" autoCapitalize="none" keyboardType="numbers-and-punctuation" />
            <Input label="Last day (YYYY-MM-DD)" value={endDate} onChangeText={setEndDate} placeholder="2026-10-14" autoCapitalize="none" keyboardType="numbers-and-punctuation" />
            <View style={{ gap: 6 }}>
              <Text style={styles.label}>Type</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {TYPES.map((t) => (
                  <Pressable
                    key={t}
                    accessibilityRole="button"
                    accessibilityState={{ selected: t === type }}
                    onPress={() => setType(t)}
                    style={{
                      paddingVertical: 8,
                      paddingHorizontal: 12,
                      borderRadius: 8,
                      borderWidth: 1,
                      borderColor: t === type ? colors.brand : colors.border,
                      backgroundColor: t === type ? colors.brand : colors.white,
                    }}
                  >
                    <Text style={{ color: t === type ? colors.white : colors.text }}>{humanize(t)}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
            <Input label="Notes for the office (optional)" value={notes} onChangeText={setNotes} placeholder="Family wedding" maxLength={500} />
            <ErrorText>{formError}</ErrorText>
            <Button title="Request time off" icon="airplane-outline" busy={saving} onPress={() => void save()} />
          </Card>
        </View>
      }
      ListEmptyComponent={
        entries ? (
          <Card style={{ alignItems: 'center', paddingVertical: 28, gap: 8 }}>
            <Ionicons name="airplane-outline" size={34} color={colors.brand} />
            <Text style={{ fontSize: 17, fontWeight: '700', color: colors.text }}>No requests yet</Text>
            <Text style={[styles.subtitle, { textAlign: 'center' }]}>Ask for time off above.</Text>
          </Card>
        ) : null
      }
      renderItem={({ item }) => (
        <Card style={{ gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ flex: 1, fontSize: 16, fontWeight: '700', color: colors.text }}>
              {dateRange(item.startDate, item.endDate)} · {item.days} day{item.days === 1 ? '' : 's'}
            </Text>
            <Text style={{ fontSize: 13, fontWeight: '700', color: item.status === 'approved' ? '#15803d' : item.status === 'denied' ? colors.danger : colors.muted }}>
              {humanize(item.status)}
            </Text>
          </View>
          <Text style={{ fontSize: 14, color: colors.muted }}>
            {humanize(item.type)}
            {item.notes ? ` — ${item.notes}` : ''}
            {item.decidedBy ? ` · decided by ${item.decidedBy.firstName} ${item.decidedBy.lastName}` : ''}
          </Text>
          {timeOffCancellable(item) && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Cancel request for ${shortDate(item.startDate)}`}
              disabled={cancelling === item.id}
              onPress={() => confirmCancel(item)}
              style={{ alignSelf: 'flex-start' }}
            >
              <Text style={{ color: colors.danger, fontWeight: '600' }}>{cancelling === item.id ? 'Cancelling…' : 'Cancel request'}</Text>
            </Pressable>
          )}
        </Card>
      )}
    />
  );
}
