import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Button, Card, ErrorText, colors } from '@/components/ui';
import { errorMessage, useAuth } from '@/lib/auth-context';

interface Lesson {
  id: string;
  title: string;
  summary: string | null;
  content: string;
  passPercent: number;
  questions: { prompt: string; options: string[] }[];
}

interface Result {
  scorePercent: number;
  passed: boolean;
  passPercent: number;
  wrongQuestions: number[];
  credentialRecorded: boolean;
}

/** One course (D-102): read the lesson, answer the quiz, see the result. Answers are checked by the server. */
export default function CourseScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { request } = useAuth();
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [answers, setAnswers] = useState<(number | null)[]>([]);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    request<Lesson>(`/training/my/${id}`)
      .then(({ data }) => {
        setLesson(data);
        setAnswers(data.questions.map(() => null));
      })
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [id, request]);

  const submit = async () => {
    if (answers.some((a) => a === null)) {
      setError('Answer every question first.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setResult((await request<Result>(`/training/my/${id}/submit`, { method: 'POST', body: { answers } })).data);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (!lesson) {
    return (
      <View style={{ flex: 1, padding: 20, backgroundColor: colors.bg }}>
        <ErrorText>{error}</ErrorText>
        {!error && <Text style={{ color: colors.muted }}>Loading…</Text>}
      </View>
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 20, gap: 14, paddingBottom: 48 }}>
      <Text style={{ fontSize: 22, fontWeight: '800', color: colors.ink }}>{lesson.title}</Text>
      <Card style={{ gap: 10 }}>
        {lesson.content.split(/\n\s*\n/).map((p, i) => (
          <Text key={i} style={{ fontSize: 16, lineHeight: 24, color: colors.text }}>
            {p.trim()}
          </Text>
        ))}
      </Card>

      {result ? (
        <Card style={{ gap: 8, backgroundColor: result.passed ? colors.successBg : colors.warningBg }}>
          <Text style={{ fontSize: 18, fontWeight: '800', color: result.passed ? colors.success : colors.warning }}>
            {result.passed ? `Passed — ${result.scorePercent}%` : `${result.scorePercent}% — you need ${result.passPercent}%`}
          </Text>
          {result.credentialRecorded && <Text style={{ color: colors.text }}>It has been added to your credentials.</Text>}
          {result.wrongQuestions.length > 0 && (
            <Text style={{ color: colors.text }}>Have another look at question{result.wrongQuestions.length === 1 ? '' : 's'} {result.wrongQuestions.join(', ')}.</Text>
          )}
          {result.passed ? (
            <Button title="Back to training" onPress={() => router.back()} />
          ) : (
            <Button
              title="Try again"
              onPress={() => {
                setResult(null);
                setAnswers(lesson.questions.map(() => null));
              }}
            />
          )}
        </Card>
      ) : (
        <>
          <Text style={{ fontSize: 18, fontWeight: '700', color: colors.ink }}>Quiz — {lesson.passPercent}% to pass</Text>
          {lesson.questions.map((q, i) => (
            <Card key={i} style={{ gap: 8 }}>
              <Text style={{ fontSize: 16, fontWeight: '600', color: colors.text }}>
                {i + 1}. {q.prompt}
              </Text>
              {q.options.map((o, k) => {
                const picked = answers[i] === k;
                return (
                  <Pressable
                    key={k}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: picked }}
                    onPress={() => setAnswers(answers.map((a, j) => (j === i ? k : a)))}
                    style={{ padding: 12, borderRadius: 12, borderWidth: 1, borderColor: picked ? colors.brand : colors.border, backgroundColor: picked ? colors.brandSoft : colors.white }}
                  >
                    <Text style={{ fontSize: 15, color: picked ? colors.brandDark : colors.text }}>{o}</Text>
                  </Pressable>
                );
              })}
            </Card>
          ))}
          <ErrorText>{error}</ErrorText>
          <Button title="Submit answers" icon="checkmark-circle-outline" onPress={() => void submit()} busy={busy} />
        </>
      )}
    </ScrollView>
  );
}
