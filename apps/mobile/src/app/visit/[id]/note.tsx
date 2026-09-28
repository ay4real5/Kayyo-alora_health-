import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Button, ErrorText, Input, colors, styles } from '@/components/ui';
import { errorMessage, useAuth } from '@/lib/auth-context';

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

/**
 * The caregiver's note for this visit (DECISIONS D-039): aides write what they did and submit; clinicians write SOAP
 * and sign. A finalised note is locked — corrections are addenda.
 */
export default function NoteScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { request, user } = useAuth();
  const canSign = Boolean(user?.permissions.includes('visit_notes:sign'));
  const [notes, setNotes] = useState<Note[]>([]);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [amends, setAmends] = useState<string | null>(null);
  const [fields, setFields] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await request<Note[]>(`/schedule/visits/${id}/notes`);
      setNotes(data);
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
  }, [id, request, user?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const locked = notes.filter((n) => n.status !== 'draft');
  const mineLocked = locked.filter((n) => n.author.id === user?.id);
  const editing = draftId !== null || mineLocked.length === 0 || amends !== null;

  /** Saves the draft (creating it the first time); returns its id. */
  const saveDraft = async (): Promise<string> => {
    if (draftId) {
      await request(`/schedule/visits/${id}/notes/${draftId}`, { method: 'PATCH', body: fields });
      return draftId;
    }
    const noteType = amends ? 'addendum' : canSign ? 'progress' : 'aide_activity';
    const { data } = await request<Note>(`/schedule/visits/${id}/notes`, {
      method: 'POST',
      body: { noteType, ...fields, ...(amends ? { amendsNoteId: amends } : {}) },
    });
    setDraftId(data.id);
    return data.id;
  };

  const act = async (finalise: boolean) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const noteId = await saveDraft();
      if (finalise) {
        await request(`/schedule/visits/${id}/notes/${noteId}/${canSign ? 'sign' : 'submit'}`, { method: 'POST' });
        setDraftId(null);
        setAmends(null);
        setFields(EMPTY);
        setMessage(canSign ? 'Signed.' : 'Submitted.');
      } else {
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
      <ErrorText>{error}</ErrorText>
      {message && <Text style={{ color: colors.brandDark, fontWeight: '600' }}>{message}</Text>}

      {editing ? (
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
