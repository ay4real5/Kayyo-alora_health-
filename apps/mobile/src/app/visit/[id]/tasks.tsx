import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { ErrorText, colors, styles } from '@/components/ui';
import { OfflineBanner } from '@/components/offline-banner';
import { errorMessage } from '@/lib/auth-context';
import { useOffline } from '@/lib/offline';

interface Task {
  id: string;
  taskName: string;
  description: string | null;
  state: 'open' | 'done' | 'not_done';
  notDoneReason: string | null;
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress(): void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={{
        paddingVertical: 10,
        paddingHorizontal: 14,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: active ? colors.brand : colors.border,
        backgroundColor: active ? colors.brand : colors.white,
      }}
    >
      <Text style={{ color: active ? colors.white : colors.text, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

/** The visit's checklist: done, or not done with a reason ("Patient declined"). Tap again to undo. */
export default function TasksScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { read, submit } = useOffline();
  const [stale, setStale] = useState(false);
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { data, stale: fromPhone } = await read<Task[]>(`/schedule/visits/${id}/tasks`);
      setTasks(data);
      setStale(fromPhone);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [id, read]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (task: Task, body: { completed: boolean; notDoneReason?: string }) => {
    setError(null);
    try {
      const result = await submit({ kind: 'task', visitId: id, taskId: task.id, body });
      // Offline: show the change now; it's sent with the queue.
      const updated: Task =
        result.outcome === 'sent' && result.data
          ? (result.data as Task)
          : {
              ...task,
              state: body.completed ? 'done' : body.notDoneReason ? 'not_done' : 'open',
              notDoneReason: body.notDoneReason ?? null,
            };
      setTasks((list) => list?.map((t) => (t.id === task.id ? updated : t)) ?? null);
      setAsking(null);
      setReason('');
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
      <OfflineBanner stale={stale} />
      <ErrorText>{error}</ErrorText>
      {tasks?.length === 0 && <Text style={styles.subtitle}>No tasks for this visit.</Text>}
      {tasks?.map((task) => (
        <View key={task.id} style={styles.card}>
          <Text style={{ fontSize: 17, fontWeight: '600', color: colors.text }}>{task.taskName}</Text>
          {task.description && <Text style={{ color: colors.muted }}>{task.description}</Text>}
          {task.state === 'not_done' && <Text style={{ color: '#92400e' }}>Not done: {task.notDoneReason}</Text>}
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
            <Chip
              label="Done"
              active={task.state === 'done'}
              onPress={() => void save(task, { completed: task.state !== 'done' })}
            />
            <Chip
              label="Not done"
              active={task.state === 'not_done' || asking === task.id}
              onPress={() => (task.state === 'not_done' ? void save(task, { completed: false }) : setAsking(task.id))}
            />
          </View>
          {asking === task.id && (
            <View style={{ gap: 8, marginTop: 8 }}>
              <TextInput
                accessibilityLabel="Why wasn't it done?"
                placeholder="Why? e.g. Patient declined"
                value={reason}
                onChangeText={setReason}
                style={styles.input}
                autoFocus
              />
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Chip
                  label="Save"
                  active
                  onPress={() => reason.trim() && void save(task, { completed: false, notDoneReason: reason.trim() })}
                />
                <Chip label="Cancel" active={false} onPress={() => setAsking(null)} />
              </View>
            </View>
          )}
        </View>
      ))}
    </ScrollView>
  );
}
