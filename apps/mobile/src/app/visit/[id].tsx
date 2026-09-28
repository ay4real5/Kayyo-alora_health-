import Constants from 'expo-constants';
import * as Location from 'expo-location';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Linking, Platform, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Button, ErrorText, colors, styles } from '@/components/ui';
import { errorMessage, useAuth } from '@/lib/auth-context';
import { clockBody, clockMessage, directionsUrl, isFresh, type ClockResult, type Fix } from '@/lib/evv';

interface Visit {
  id: string;
  patient: { id: string; firstName: string; lastName: string };
  visitType: string;
  status: string;
  scheduledDate: string;
  scheduledStart: string;
  scheduledEnd: string;
  actualStart: string | null;
  actualEnd: string | null;
  notes: string | null;
}

interface Patient {
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phoneHome: string | null;
  phoneCell: string | null;
}

const humanize = (code: string) => code.charAt(0).toUpperCase() + code.slice(1).replaceAll('_', ' ');
const clock = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—';

/** Where the caregiver is right now: a fresh GPS fix, asking for permission the first time. */
async function currentFix(): Promise<Fix> {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (!permission.granted) {
    throw new Error('Alora needs your location to clock in and out (electronic visit verification). Allow it in Settings.');
  }
  const last = await Location.getLastKnownPositionAsync();
  if (last && isFresh(last, Date.now())) return last;
  return Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
}

/** One visit: patient, address with directions, and clock in / clock out with GPS (DECISIONS D-038, D-046). */
export default function VisitScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { request } = useAuth();
  const [visit, setVisit] = useState<Visit | null>(null);
  const [patient, setPatient] = useState<Patient | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ title: string; detail: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const { data } = await request<Visit>(`/schedule/visits/${id}`);
      setVisit(data);
      const p = await request<Patient>(`/patients/${data.patient.id}`);
      setPatient(p.data);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [id, request]);

  useEffect(() => {
    void load();
  }, [load]);

  const clockAction = async (kind: 'in' | 'out') => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const pressedAt = new Date();
      const fix = await currentFix();
      const { data } = await request<ClockResult>(`/evv/clock-${kind}`, {
        method: 'POST',
        body: clockBody(id, fix, pressedAt, Constants.expoConfig?.version),
      });
      setNotice(clockMessage(kind, data));
      await load();
    } catch (e) {
      setError(e instanceof Error && !('status' in e) && e.name !== 'OfflineError' ? e.message : errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const address = patient
    ? [patient.addressLine1, patient.addressLine2, [patient.city, patient.state, patient.zip].filter(Boolean).join(' ')]
        .filter(Boolean)
        .join(', ')
    : '';
  const phone = patient?.phoneCell ?? patient?.phoneHome;

  return (
    <ScrollView
      contentContainerStyle={styles.screen}
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
    >
      <Stack.Screen options={{ title: visit ? humanize(visit.visitType) : 'Visit' }} />
      <ErrorText>{error}</ErrorText>
      {notice && (
        <View accessibilityRole="alert" style={[styles.card, { borderColor: colors.brand }]}>
          <Text style={{ fontSize: 17, fontWeight: '700', color: colors.brandDark }}>{notice.title}</Text>
          {notice.detail && <Text style={{ color: colors.text }}>{notice.detail}</Text>}
        </View>
      )}
      {!visit ? (
        <Text style={styles.subtitle}>{error ? '' : 'Loading…'}</Text>
      ) : (
        <>
          <View style={styles.card}>
            <Text style={styles.title}>
              {visit.patient.firstName} {visit.patient.lastName}
            </Text>
            <Text style={styles.subtitle}>
              {visit.scheduledDate} · {visit.scheduledStart}–{visit.scheduledEnd} · {humanize(visit.status)}
            </Text>
            {visit.actualStart && (
              <Text style={{ color: colors.text }}>
                Clocked in {clock(visit.actualStart)}
                {visit.actualEnd ? ` · out ${clock(visit.actualEnd)}` : ''}
              </Text>
            )}
            {visit.notes && <Text style={{ color: colors.muted }}>{visit.notes}</Text>}
          </View>

          {address ? (
            <View style={styles.card}>
              <Text style={styles.label}>Address</Text>
              <Text style={{ fontSize: 16, color: colors.text }}>{address}</Text>
              <View style={{ gap: 8, marginTop: 8 }}>
                <Button title="Directions" variant="secondary" onPress={() => void Linking.openURL(directionsUrl(address, Platform.OS))} />
                {phone && <Button title={`Call ${phone}`} variant="secondary" onPress={() => void Linking.openURL(`tel:${phone}`)} />}
              </View>
            </View>
          ) : null}

          {visit.status === 'scheduled' && (
            <Button title="Clock in" onPress={() => void clockAction('in')} busy={busy} />
          )}
          {visit.status === 'in_progress' && (
            <Button title="Clock out" onPress={() => void clockAction('out')} busy={busy} />
          )}
          {(visit.status === 'scheduled' || visit.status === 'in_progress') && (
            <Text style={{ color: colors.muted, fontSize: 13 }}>
              Your location is recorded only when you clock in or out, for electronic visit verification.
            </Text>
          )}
        </>
      )}
    </ScrollView>
  );
}
