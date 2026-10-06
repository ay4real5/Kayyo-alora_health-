import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { Card, ErrorText, Pill, colors } from '@/components/ui';
import { errorMessage, useAuth } from '@/lib/auth-context';

interface MyCourse {
  id: string;
  title: string;
  summary: string | null;
  questions: number;
  grantsCredential: boolean;
  status: 'not_started' | 'failed' | 'passed' | 'expired';
  lastScore: number | null;
  validUntil: string | null;
}

const STATUS: Record<MyCourse['status'], [string, string]> = {
  not_started: ['scheduled', 'To do'],
  failed: ['missed', 'Try again'],
  passed: ['completed', 'Passed'],
  expired: ['missed', 'Expired — retake'],
};

/** Primordial Academy (D-102): the caregiver's courses. */
export default function TrainingScreen() {
  const { request } = useAuth();
  const [courses, setCourses] = useState<MyCourse[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setCourses((await request<MyCourse[]>('/training/my')).data);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [request]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return (
    <FlatList
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: 20, gap: 12 }}
      data={courses ?? []}
      keyExtractor={(c) => c.id}
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
      ListHeaderComponent={
        <View style={{ gap: 8 }}>
          <ErrorText>{error}</ErrorText>
          {courses?.length === 0 && <Text style={{ color: colors.muted, fontSize: 15 }}>No training assigned to you right now.</Text>}
        </View>
      }
      renderItem={({ item }) => {
        const [status, label] = STATUS[item.status];
        return (
          <Pressable accessibilityRole="button" onPress={() => router.push(`/training/${item.id}`)}>
            <Card style={{ gap: 6 }}>
              <Text style={{ fontSize: 17, fontWeight: '700', color: colors.ink }}>{item.title}</Text>
              {item.summary ? <Text style={{ color: colors.text }}>{item.summary}</Text> : null}
              <Pill status={status} label={label} />
              <Text style={{ color: colors.muted, fontSize: 13 }}>
                {item.questions} questions{item.grantsCredential ? ' · adds a credential when you pass' : ''}
                {item.validUntil ? ` · valid until ${item.validUntil}` : ''}
                {item.lastScore !== null && item.status === 'failed' ? ` · last score ${item.lastScore}%` : ''}
              </Text>
            </Card>
          </Pressable>
        );
      }}
    />
  );
}
