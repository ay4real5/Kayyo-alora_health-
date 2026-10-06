import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Button, ErrorText, Input, colors, styles } from '@/components/ui';
import { OfflineBanner } from '@/components/offline-banner';
import { errorMessage, useAuth } from '@/lib/auth-context';
import { useOffline } from '@/lib/offline';

interface Note {
  id: string;
  noteType: string;
  status: 'draft' | 'submitted' | 'signed';
  author: { id: string; firstName: string; lastName: string };
  subjective: string | null;
  objective: string | null;
  assessment: string | null;
  plan: string | null;
  narrative: string | null;
  amendsNoteId: string | null;
  createdAt: string;
}

type Fields = Pick<Note, 'subjective' | 'objective' | 'assessment' | 'plan' | 'narrative'>;
const EMPTY: Record<keyof Fields, string> = { subjective: '', objective: '', assessment: '', plan: '', narrative: '' };
const SOAP: [keyof Fields, string][] = [
  ['subjective', 'Subjective (what the patient reports)'],
  ['objective', 'Objective (what you observed and measured)'],
  ['assessment', 'Assessment'],
  ['plan', 'Plan'],
];

interface Organized {
  narrative: string;
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
  tasksDone: { id: string; taskName: string }[];
  concerns: string[];
  possibleIncidents: { type: string; label: string; reason: string }[];
}

interface CareUpdate {
  summary: string;
  mood: string | null;
}

const MOODS: [string, string][] = [
  ['good', 'Good'],
  ['okay', 'Okay'],
  ['low', 'Low'],
];

/**
 * The caregiver's note for this visit (DECISIONS D-039): aides write what they did and submit; clinicians write SOAP
 * and sign. A finalised note is locked — corrections are addenda.
 */
export default function NoteScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user, request } = useAuth();
  const { read, submit, ops } = useOffline();
  const [stale, setStale] = useState(false);
  const canSign = Boolean(user?.permissions.includes('visit_notes:sign'));
  const [notes, setNotes] = useState<Note[]>([]);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [amends, setAmends] = useState<string | null>(null);
  const [fields, setFields] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // AI help (D-096): only when the agency has it switched on, and only online.
  const [aiOn, setAiOn] = useState(false);
  const [tidying, setTidying] = useState(false);
  const [organized, setOrganized] = useState<Organized | null>(null);
  const [careUpdate, setCareUpdate] = useState<CareUpdate | null>(null);
  const [careDraft, setCareDraft] = useState('');
  const [careMood, setCareMood] = useState<string | null>(null);
  const [careBusy, setCareBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data, stale: fromPhone } = await read<Note[]>(`/schedule/visits/${id}/notes`);
      setNotes(data);
      setStale(fromPhone);
      const draft = data.find((n) => n.status === 'draft' && n.author.id === user?.id);
      if (draft) {
        setDraftId(draft.id);
        setAmends(draft.amendsNoteId);
        setFields({
          subjective: draft.subjective ?? '',
          objective: draft.objective ?? '',
          assessment: draft.assessment ?? '',
          plan: draft.plan ?? '',
          narrative: draft.narrative ?? '',
        });
      }
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [id, read, user?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    request<{ enabled: boolean }>('/ai/status')
      .then(({ data }) => setAiOn(data.enabled))
      .catch(() => setAiOn(false));
    request<CareUpdate | null>(`/schedule/visits/${id}/care-update`)
      .then(({ data }) => setCareUpdate(data))
      .catch(() => undefined);
  }, [id, request]);

  const tidy = async () => {
    const text = [fields.narrative, fields.subjective, fields.objective, fields.assessment, fields.plan].filter((t) => t.trim()).join('\n');
    if (!text.trim()) {
      setError('Type or dictate what you did first, then tidy it up.');
      return;
    }
    setTidying(true);
    setError(null);
    try {
      const { data } = await request<Organized>(`/schedule/visits/${id}/notes/organize`, { method: 'POST', body: { text } });
      setOrganized(data);
      setFields((f) =>
        canSign
          ? {
              subjective: data.subjective || f.subjective,
              objective: data.objective || f.objective,
              assessment: data.assessment || f.assessment,
              plan: data.plan || f.plan,
              narrative: data.narrative || f.narrative,
            }
          : { ...f, narrative: data.narrative || f.narrative },
      );
      setMessage('Tidied up — please read it and fix anything that isn’t right before submitting.');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setTidying(false);
    }
  };

  const suggestCareUpdate = async () => {
    setCareBusy(true);
    setError(null);
    try {
      const { data } = await request<CareUpdate>(`/schedule/visits/${id}/care-update/suggest`, { method: 'POST' });
      setCareDraft(data.summary);
      setCareMood(data.mood);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setCareBusy(false);
    }
  };

  const sendCareUpdate = async () => {
    if (!careDraft.trim()) return;
    setCareBusy(true);
    setError(null);
    try {
      const { data } = await request<CareUpdate>(`/schedule/visits/${id}/care-update`, {
        method: 'POST',
        body: { summary: careDraft.trim(), ...(careMood ? { mood: careMood } : {}) },
      });
      setCareUpdate(data);
      setMessage('Care update sent to the family.');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setCareBusy(false);
    }
  };

  const locked = notes.filter((n) => n.status !== 'draft');
  const mineLocked = locked.filter((n) => n.author.id === user?.id);
  const editing = draftId !== null || mineLocked.length === 0 || amends !== null;

  // A note for this visit waiting in the queue: pause editing so a second save can't create a duplicate note.
  const pending = ops.some((op) => op.kind === 'note' && op.visitId === id && !op.failure);

  const act = async (finalise: boolean) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await submit({
        kind: 'note',
        visitId: id,
        draftId,
        noteType: amends ? 'addendum' : canSign ? 'progress' : 'aide_activity',
        amendsNoteId: amends,
        fields,
        finalise: finalise ? (canSign ? 'sign' : 'submit') : null,
      });
      if (result.outcome === 'queued') {
        setMessage('Saved on this phone — it will be sent when there is a connection.');
        if (finalise) {
          setAmends(null);
          setFields(EMPTY);
        }
        return;
      }
      if (finalise) {
        setDraftId(null);
        setAmends(null);
        setFields(EMPTY);
        setMessage(canSign ? 'Signed.' : 'Submitted.');
      } else {
        setDraftId((result.data as { id: string }).id);
        setMessage('Draft saved.');
      }
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const set = (key: keyof Fields) => (value: string) => setFields((f) => ({ ...f, [key]: value }));
  return (
    <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
      <OfflineBanner stale={stale} />
      <ErrorText>{error}</ErrorText>
      {message && <Text style={{ color: colors.brandDark, fontWeight: '600' }}>{message}</Text>}

      {pending ? (
        <Text style={styles.subtitle}>Your note is saved on this phone and waiting to be sent.</Text>
      ) : editing ? (
        <>
          {amends && <Text style={styles.subtitle}>Addendum — adds to your finalised note.</Text>}
          {canSign && SOAP.map(([key, label]) => <Input key={key} label={label} value={fields[key]} onChangeText={set(key)} multiline />)}
          <Input
            label={canSign ? 'Narrative' : 'What you did this visit'}
            value={fields.narrative}
            onChangeText={set('narrative')}
            multiline
            style={[styles.input, { minHeight: 120, textAlignVertical: 'top' }]}
          />
          <Text style={{ color: colors.muted, fontSize: 13 }}>Tip: tap the microphone on your keyboard to speak instead of typing.</Text>
          {aiOn && (
            <Button title="Tidy up with AI" icon="sparkles-outline" variant="secondary" onPress={() => void tidy()} busy={tidying} />
          )}
          {organized && (organized.possibleIncidents.length > 0 || organized.concerns.length > 0 || organized.tasksDone.length > 0) && (
            <View style={[styles.card, { gap: 6 }]}>
              {organized.possibleIncidents.map((i) => (
                <View key={i.type} style={{ backgroundColor: colors.warningBg, borderRadius: 12, padding: 10 }}>
                  <Text style={{ color: colors.warning, fontWeight: '700' }}>{i.label}</Text>
                  <Text style={{ color: colors.warning }}>{i.reason} Your supervisor will be asked to review this note. Call the office if anyone is hurt.</Text>
                </View>
              ))}
              {organized.tasksDone.length > 0 && (
                <Text style={{ color: colors.text }}>Tasks you mentioned: {organized.tasksDone.map((t) => t.taskName).join(', ')} — tick them on the Tasks screen.</Text>
              )}
              {organized.concerns.map((c) => (
                <Text key={c} style={{ color: colors.text }}>• For the office: {c}</Text>
              ))}
            </View>
          )}
          <Button title="Save draft" variant="secondary" onPress={() => void act(false)} busy={busy} />
          <Button title={canSign ? 'Sign note' : 'Submit note'} onPress={() => void act(true)} busy={busy} />
          <Text style={{ color: colors.muted, fontSize: 13 }}>
            {canSign ? 'Signing' : 'Submitting'} locks the note. Later corrections are added as an addendum.
          </Text>
        </>
      ) : (
        <Button
          title="Add an addendum"
          variant="secondary"
          onPress={() => setAmends(mineLocked[mineLocked.length - 1]!.id)}
        />
      )}

      {mineLocked.length > 0 && !pending && (
        <View style={[styles.card, { gap: 8 }]}>
          <Text style={{ fontSize: 16, fontWeight: '700', color: colors.ink }}>Care update for the family</Text>
          {careUpdate ? (
            <>
              <Text style={{ color: colors.text }}>{careUpdate.summary}</Text>
              <Text style={{ color: colors.muted, fontSize: 13 }}>Sent — the family can see it in their portal.</Text>
            </>
          ) : (
            <>
              <Text style={{ color: colors.muted, fontSize: 13 }}>Optional: a short, friendly update the family sees in their portal. No medical details.</Text>
              {aiOn && <Button title="Suggest from my note" icon="sparkles-outline" variant="secondary" onPress={() => void suggestCareUpdate()} busy={careBusy} />}
              <Input label="Update" value={careDraft} onChangeText={setCareDraft} multiline maxLength={1000} placeholder="e.g. Had a shower, ate most of breakfast and enjoyed a short walk." />
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {MOODS.map(([value, label]) => (
                  <Pressable
                    key={value}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: careMood === value }}
                    onPress={() => setCareMood(careMood === value ? null : value)}
                    style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: careMood === value ? colors.brand : colors.border, backgroundColor: careMood === value ? colors.brandSoft : colors.white }}
                  >
                    <Text style={{ color: careMood === value ? colors.brandDark : colors.text, fontWeight: '600' }}>Mood: {label}</Text>
                  </Pressable>
                ))}
              </View>
              <Button title="Send to family" icon="heart-outline" onPress={() => void sendCareUpdate()} busy={careBusy} />
            </>
          )}
        </View>
      )}

      {locked.map((n) => (
        <View key={n.id} style={styles.card}>
          <Text style={{ color: colors.muted }}>
            {n.amendsNoteId ? 'Addendum' : 'Note'} by {n.author.firstName} {n.author.lastName} · {n.status}
          </Text>
          {SOAP.map(([key, label]) => (n[key] ? <Text key={key}>{`${label.split(' ')[0]}: ${n[key]}`}</Text> : null))}
          {n.narrative && <Text style={{ color: colors.text }}>{n.narrative}</Text>}
        </View>
      ))}
    </ScrollView>
  );
}
