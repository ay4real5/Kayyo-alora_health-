import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, FlatList, RefreshControl, Text, View } from 'react-native';
import { Button, Card, ErrorText, colors, styles } from '@/components/ui';
import { errorMessage, useAuth } from '@/lib/auth-context';
import { hoursBetween, shortDate } from '@/lib/extras';
import { humanize, time } from '@/lib/visits';

interface OpenShift {
  id: string;
  notes: string | null;
  expiresAt: string | null;
  visit: { id: string; visitType: string; scheduledDate: string; scheduledStart: string; scheduledEnd: string; priority: string };
  /** Where, roughly: the patient's name shows once the visit is yours. */
  area: { city: string | null; zip: string | null };
}

/** Shifts the office has offered that this caregiver can take (D-040, D-083). First to claim gets it. */
export default function OpenShiftsScreen() {
  const { request } = useAuth();
  const [shifts, setShifts] = useState<OpenShift[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [claiming, setClaiming] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setShifts((await request<OpenShift[]>('/schedule/open-shifts?limit=50')).data);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [request]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const claim = async (shift: OpenShift) => {
    setClaiming(shift.id);
    setError(null);
    try {
      await request(`/schedule/open-shifts/${shift.id}/claim`, { method: 'POST' });
      Alert.alert('The shift is yours', 'It’s now on your schedule with the patient’s details.', [
        { text: 'Open visit', onPress: () => router.replace({ pathname: '/visit/[id]', params: { id: shift.visit.id } }) },
        { text: 'OK', onPress: () => void load() },
      ]);
    } catch (e) {
      setError(errorMessage(e));
      void load();
    } finally {
      setClaiming(null);
    }
  };

  const confirm = (shift: OpenShift) =>
    Alert.alert(
      'Take this shift?',
      `${shortDate(shift.visit.scheduledDate)}, ${time(shift.visit.scheduledStart)} – ${time(shift.visit.scheduledEnd)}`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Take it', onPress: () => void claim(shift) },
      ],
    );

  return (
    <FlatList
      style={{ backgroundColor: colors.bg }}
      data={shifts ?? []}
      keyExtractor={(s) => s.id}
      contentContainerStyle={{ padding: 20, gap: 12, paddingBottom: 32 }}
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
          <Text style={styles.subtitle}>Shifts you can pick up. The first person to take one gets it.</Text>
          <ErrorText>{error}</ErrorText>
        </View>
      }
      ListEmptyComponent={
        shifts ? (
          <Card style={{ alignItems: 'center', paddingVertical: 28, gap: 8 }}>
            <Ionicons name="briefcase-outline" size={34} color={colors.brand} />
            <Text style={{ fontSize: 17, fontWeight: '700', color: colors.text }}>No open shifts right now</Text>
            <Text style={[styles.subtitle, { textAlign: 'center' }]}>You’ll get an alert when the office posts one.</Text>
          </Card>
        ) : null
      }
      renderItem={({ item }) => {
        const v = item.visit;
        const where = [item.area.city, item.area.zip].filter(Boolean).join(' ') || 'Area not set';
        return (
          <Card style={{ gap: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ flex: 1, fontSize: 17, fontWeight: '800', color: colors.ink }}>{shortDate(v.scheduledDate)}</Text>
              {v.priority !== 'normal' && (
                <View style={{ backgroundColor: colors.warningBg, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 }}>
                  <Text style={{ color: colors.warning, fontWeight: '700', fontSize: 12 }}>{humanize(v.priority)}</Text>
                </View>
              )}
            </View>
            <View style={{ gap: 6 }}>
              <Row icon="time-outline" text={`${time(v.scheduledStart)} – ${time(v.scheduledEnd)} · ${hoursBetween(v.scheduledStart, v.scheduledEnd)} h`} />
              <Row icon="medkit-outline" text={humanize(v.visitType)} />
              <Row icon="location-outline" text={where} />
              {item.notes ? <Row icon="document-text-outline" text={item.notes} /> : null}
            </View>
            <Button title="Take this shift" icon="hand-right-outline" busy={claiming === item.id} onPress={() => confirm(item)} />
          </Card>
        );
      }}
    />
  );
}

function Row({ icon, text }: { icon: 'time-outline' | 'medkit-outline' | 'location-outline' | 'document-text-outline'; text: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Ionicons name={icon} size={17} color={colors.brand} />
      <Text style={{ flex: 1, fontSize: 15, color: colors.text }}>{text}</Text>
    </View>
  );
}
