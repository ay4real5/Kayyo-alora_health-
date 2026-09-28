import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Button, ErrorText, Input, colors, styles } from '@/components/ui';
import { OfflineBanner } from '@/components/offline-banner';
import { errorMessage } from '@/lib/auth-context';
import { useOffline } from '@/lib/offline';
import { EMPTY_VITALS, vitalsPayload, type VitalsForm } from '@/lib/vitals';

interface Vital {
  id: string;
  bloodPressureSystolic: number | null;
  bloodPressureDiastolic: number | null;
  heartRate: number | null;
  respiratoryRate: number | null;
  temperature: number | null;
  temperatureUnit: string;
  oxygenSaturation: number | null;
  painLevel: number | null;
  bloodGlucose: number | null;
  weight: number | null;
  weightUnit: string;
  recordedAt: string;
  enteredInError: { reason: string | null } | null;
}

function summary(v: Vital): string {
  return [
    v.bloodPressureSystolic !== null && `BP ${v.bloodPressureSystolic}/${v.bloodPressureDiastolic}`,
    v.heartRate !== null && `HR ${v.heartRate}`,
    v.respiratoryRate !== null && `RR ${v.respiratoryRate}`,
    v.temperature !== null && `${v.temperature} °${v.temperatureUnit}`,
    v.oxygenSaturation !== null && `SpO₂ ${v.oxygenSaturation}%`,
    v.painLevel !== null && `Pain ${v.painLevel}/10`,
    v.bloodGlucose !== null && `Glucose ${v.bloodGlucose}`,
    v.weight !== null && `${v.weight} ${v.weightUnit}`,
  ]
    .filter(Boolean)
    .join(' · ');
}

function Toggle<T extends string>({ options, value, onChange }: { options: T[]; value: T; onChange(v: T): void }) {
  return (
    <View style={{ flexDirection: 'row', gap: 6 }}>
      {options.map((o) => (
        <Pressable
          key={o}
          accessibilityRole="button"
          accessibilityState={{ selected: o === value }}
          onPress={() => onChange(o)}
          style={{
            paddingVertical: 8,
            paddingHorizontal: 12,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: o === value ? colors.brand : colors.border,
            backgroundColor: o === value ? colors.brand : colors.white,
          }}
        >
          <Text style={{ color: o === value ? colors.white : colors.text }}>{o === 'F' || o === 'C' ? `°${o}` : o}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/** Record vitals (checked on the phone with the API's ranges); earlier readings listed below. */
export default function VitalsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { read, submit: send } = useOffline();
  const [stale, setStale] = useState(false);
  const [form, setForm] = useState<VitalsForm>(EMPTY_VITALS);
  const [vitals, setVitals] = useState<Vital[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (key: keyof VitalsForm) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

  const load = useCallback(async () => {
    try {
      const { data, stale: fromPhone } = await read<Vital[]>(`/schedule/visits/${id}/vitals`);
      setVitals(data);
      setStale(fromPhone);
    } catch (e) {
      setErrors([errorMessage(e)]);
    }
  }, [id, read]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async () => {
    setSaved(null);
    const { body, errors: problems } = vitalsPayload(form);
    setErrors(problems);
    if (!body) return;
    setBusy(true);
    try {
      // recordedAt = now, so readings sent later from the queue keep the time they were taken.
      const result = await send({
        kind: 'vitals',
        visitId: id,
        body: { ...body, recordedAt: new Date().toISOString() },
      });
      setForm(EMPTY_VITALS);
      setSaved(result.outcome === 'sent' ? 'Saved.' : 'Saved on this phone — will be sent when there is a connection.');
      await load();
    } catch (e) {
      setErrors([errorMessage(e)]);
    } finally {
      setBusy(false);
    }
  };

  const numeric = { keyboardType: 'decimal-pad' as const };
  return (
    <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
      <OfflineBanner stale={stale} />
      <ErrorText>{errors.length ? errors.join('\n') : null}</ErrorText>
      {saved && <Text style={{ color: colors.brandDark, fontWeight: '600' }}>{saved}</Text>}
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Input label="BP upper" value={form.systolic} onChangeText={set('systolic')} {...numeric} />
        </View>
        <View style={{ flex: 1 }}>
          <Input label="BP lower" value={form.diastolic} onChangeText={set('diastolic')} {...numeric} />
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Input label="Heart rate" value={form.heartRate} onChangeText={set('heartRate')} {...numeric} />
        </View>
        <View style={{ flex: 1 }}>
          <Input label="Breathing rate" value={form.respiratoryRate} onChangeText={set('respiratoryRate')} {...numeric} />
        </View>
      </View>
      <Input label="Temperature" value={form.temperature} onChangeText={set('temperature')} {...numeric} />
      <Toggle options={['F', 'C'] as ('F' | 'C')[]} value={form.temperatureUnit} onChange={(v) => setForm((f) => ({ ...f, temperatureUnit: v }))} />
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Input label="Oxygen (SpO₂ %)" value={form.oxygenSaturation} onChangeText={set('oxygenSaturation')} {...numeric} />
        </View>
        <View style={{ flex: 1 }}>
          <Input label="Pain (0–10)" value={form.painLevel} onChangeText={set('painLevel')} {...numeric} />
        </View>
      </View>
      <Input label="Blood sugar (mg/dL)" value={form.bloodGlucose} onChangeText={set('bloodGlucose')} {...numeric} />
      <Input label="Weight" value={form.weight} onChangeText={set('weight')} {...numeric} />
      <Toggle options={['lbs', 'kg'] as ('lbs' | 'kg')[]} value={form.weightUnit} onChange={(v) => setForm((f) => ({ ...f, weightUnit: v }))} />
      <Input label="Notes" value={form.notes} onChangeText={set('notes')} multiline />
      <Button title="Save vitals" onPress={() => void submit()} busy={busy} />

      {vitals.length > 0 && <Text style={[styles.label, { marginTop: 8 }]}>Recorded this visit</Text>}
      {vitals.map((v) => (
        <View key={v.id} style={styles.card}>
          <Text style={{ color: colors.muted }}>
            {new Date(v.recordedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
          </Text>
          <Text style={{ color: v.enteredInError ? colors.muted : colors.text, textDecorationLine: v.enteredInError ? 'line-through' : 'none' }}>
            {summary(v)}
          </Text>
          {v.enteredInError && <Text style={{ color: colors.muted }}>Marked as entered in error</Text>}
        </View>
      ))}
    </ScrollView>
  );
}
