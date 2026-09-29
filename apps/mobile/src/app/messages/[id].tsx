import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ErrorText, colors } from '@/components/ui';
import { errorMessage, useAuth } from '@/lib/auth-context';
import { conversationTitle, shortWhen, type Conversation, type Message } from '@/lib/extras';

const REFRESH_MS = 15_000;

/** One conversation: newest at the bottom; checks for new messages every 15 s while open. */
export default function ConversationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user, request } = useAuth();
  const insets = useSafeAreaInsets();
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [draft, setDraft] = useState('');
  const [urgent, setUrgent] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const newest = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [c, m] = await Promise.all([
        request<Conversation>(`/messages/conversations/${id}`),
        request<Message[]>(`/messages/conversations/${id}/messages?limit=50`),
      ]);
      setConversation(c.data);
      setMessages(m.data);
      setError(null);
      if (m.data[0] && m.data[0].id !== newest.current) {
        newest.current = m.data[0].id;
        await request(`/messages/conversations/${id}/read`, { method: 'POST' }).catch(() => undefined);
      }
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [id, request]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  const send = async () => {
    const content = draft.trim();
    if (!content || sending) return;
    setSending(true);
    setError(null);
    try {
      const { data } = await request<Message>(`/messages/conversations/${id}/messages`, { method: 'POST', body: { content, isUrgent: urgent } });
      newest.current = data.id;
      setMessages((list) => [data, ...(list ?? [])]);
      setDraft('');
      setUrgent(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSending(false);
    }
  };

  if (!user) return null;
  const title = conversation ? conversationTitle(conversation, user.id) : 'Messages';
  const canSend = Boolean(draft.trim()) && !sending;

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <Stack.Screen options={{ title }} />
      {conversation?.patient && (
        <View style={{ backgroundColor: colors.brandSoft, paddingHorizontal: 20, paddingVertical: 8 }}>
          <Text style={{ color: colors.brandDark, fontWeight: '600' }}>
            About {conversation.patient.firstName} {conversation.patient.lastName}
          </Text>
        </View>
      )}
      <FlatList
        inverted
        data={messages ?? []}
        keyExtractor={(m) => m.id}
        contentContainerStyle={{ padding: 16, gap: 8 }}
        renderItem={({ item, index }) => {
          const mine = item.sender.id === user.id;
          const older = messages?.[index + 1];
          const showName = !mine && conversation?.type !== 'direct' && older?.sender.id !== item.sender.id;
          return (
            <View style={{ alignItems: mine ? 'flex-end' : 'flex-start' }}>
              {showName && (
                <Text style={{ fontSize: 12, color: colors.muted, marginLeft: 10, marginBottom: 2 }}>
                  {item.sender.firstName} {item.sender.lastName}
                </Text>
              )}
              <View
                accessible
                accessibilityLabel={`${mine ? 'You' : `${item.sender.firstName} ${item.sender.lastName}`}${item.isUrgent ? ', urgent' : ''}: ${item.content}`}
                style={{
                  maxWidth: '82%',
                  backgroundColor: mine ? colors.brand : colors.white,
                  borderRadius: 18,
                  borderBottomRightRadius: mine ? 6 : 18,
                  borderBottomLeftRadius: mine ? 18 : 6,
                  paddingHorizontal: 14,
                  paddingVertical: 10,
                  borderWidth: item.isUrgent ? 2 : mine ? 0 : 1,
                  borderColor: item.isUrgent ? colors.danger : colors.border,
                }}
              >
                {item.isUrgent && <Text style={{ color: mine ? '#fecdd3' : colors.danger, fontSize: 12, fontWeight: '800', marginBottom: 2 }}>URGENT</Text>}
                <Text style={{ color: mine ? colors.white : colors.text, fontSize: 16 }}>{item.content}</Text>
                {item.document && (
                  <Text style={{ color: mine ? '#ddd6fe' : colors.brandDark, fontSize: 13, marginTop: 4 }}>
                    Attachment: {item.document.title} (open it on the dashboard)
                  </Text>
                )}
                <Text style={{ color: mine ? '#ddd6fe' : colors.muted, fontSize: 11, marginTop: 4, alignSelf: 'flex-end' }}>{shortWhen(item.createdAt)}</Text>
              </View>
            </View>
          );
        }}
      />
      {messages?.length === 0 && <Text style={{ color: colors.muted, textAlign: 'center', padding: 16 }}>No messages yet.</Text>}
      {error && (
        <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
          <ErrorText>{error}</ErrorText>
        </View>
      )}
      {conversation?.left ? (
        <Text style={{ textAlign: 'center', color: colors.muted, padding: 16, paddingBottom: insets.bottom + 16 }}>You left this conversation.</Text>
      ) : (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'flex-end',
            gap: 8,
            padding: 12,
            paddingBottom: insets.bottom + 12,
            backgroundColor: colors.white,
            borderTopWidth: 1,
            borderTopColor: colors.border,
          }}
        >
          <Pressable
            accessibilityRole="switch"
            accessibilityLabel="Mark as urgent"
            accessibilityState={{ checked: urgent }}
            onPress={() => setUrgent((u) => !u)}
            style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: urgent ? colors.dangerBg : colors.bg }}
          >
            <Ionicons name={urgent ? 'alert-circle' : 'alert-circle-outline'} size={24} color={urgent ? colors.danger : colors.muted} />
          </Pressable>
          <TextInput
            accessibilityLabel="Message"
            placeholder={urgent ? 'Urgent message…' : 'Message'}
            placeholderTextColor="#8a93a6"
            value={draft}
            onChangeText={setDraft}
            multiline
            maxLength={5000}
            style={{
              flex: 1,
              maxHeight: 120,
              minHeight: 44,
              borderRadius: 22,
              borderWidth: 1,
              borderColor: colors.border,
              paddingHorizontal: 16,
              paddingVertical: 11,
              fontSize: 16,
              color: colors.text,
              backgroundColor: colors.bg,
            }}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send"
            accessibilityState={{ disabled: !canSend }}
            disabled={!canSend}
            onPress={() => void send()}
            style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: canSend ? colors.brand : '#cbd5e1' }}
          >
            <Ionicons name="send" size={19} color={colors.white} />
          </Pressable>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}
