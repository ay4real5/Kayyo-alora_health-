import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';
import { Button, Card, ErrorText, Input, colors, styles } from '@/components/ui';
import { errorMessage, useAuth } from '@/lib/auth-context';
import { mileageError, shortDate, type MileageEntry } from '@/lib/extras';
import { humanize } from '@/lib/visits';

/** The caregiver's own mileage entries and a form to log new travel (D-083). Payroll approves them for the pay stub. */
export default function MileageScreen() {
  const { request } = useAuth();
  const [entries, setEntries] = useState<MileageEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [date, setDate] = useState('');
  const [miles, setMiles] = useState('');
  const [description, setDescription] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setEntries((await request<MileageEntry[]>('/payroll/mileage?limit=50')).data);
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
    const problem = mileageError(date.trim(), miles.trim());
    setFormError(problem);
    if (problem || saving) return;
    setSaving(true);
    setFormError(null);
    try {
      const note = description.trim();
      await request('/payroll/mileage', {
        method: 'POST',
        body: { travelDate: date.trim(), miles: Number(miles), ...(note ? { description: note } : {}) },
      });
      setDate('');
      setMiles('');
      setDescription('');
      await load();
    } catch (e) {
      setFormError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <FlatList
      style={{ backgroundColor: colors.bg }}
      data={entries ?? []}
      keyExtractor={(m) => m.id}
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
          <Text style={styles.subtitle}>Log the miles you drive for visits. The office approves them for pay.</Text>
          <ErrorText>{error}</ErrorText>
          <Card style={{ gap: 12 }}>
            <Input label="Date (YYYY-MM-DD)" value={date} onChangeText={setDate} placeholder="2026-10-05" autoCapitalize="none" keyboardType="numbers-and-punctuation" />
            <Input label="Miles" value={miles} onChangeText={setMiles} placeholder="12.5" keyboardType="decimal-pad" />
            <Input label="Where to? (optional)" value={description} onChangeText={setDescription} placeholder="Visit and back" maxLength={255} />
            <ErrorText>{formError}</ErrorText>
            <Button title="Log mileage" icon="navigate-outline" busy={saving} onPress={() => void save()} />
          </Card>
        </View>
      }
      ListEmptyComponent={
        entries ? (
          <Card style={{ alignItems: 'center', paddingVertical: 28, gap: 8 }}>
            <Ionicons name="navigate-outline" size={34} color={colors.brand} />
            <Text style={{ fontSize: 17, fontWeight: '700', color: colors.text }}>No mileage yet</Text>
            <Text style={[styles.subtitle, { textAlign: 'center' }]}>Log your first trip above.</Text>
          </Card>
        ) : null
      }
      renderItem={({ item }) => (
        <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: colors.brandSoft, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="car-outline" size={20} color={colors.brand} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text }}>
              {shortDate(item.travelDate)} · {item.miles} mi
            </Text>
            {item.description ? <Text style={{ fontSize: 14, color: colors.muted }}>{item.description}</Text> : null}
            {item.status === 'rejected' && item.rejectReason ? (
              <Text style={{ fontSize: 13, color: colors.danger }}>Not approved: {item.rejectReason}</Text>
            ) : null}
          </View>
          <Text style={{ fontSize: 13, fontWeight: '700', color: item.status === 'approved' ? '#15803d' : item.status === 'rejected' ? colors.danger : colors.muted }}>
            {humanize(item.status)}
          </Text>
        </Card>
      )}
    />
  );
}
