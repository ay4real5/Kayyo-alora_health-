import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, FlatList, Image, KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ErrorText, colors } from '@/components/ui';
import { API_URL, ApiError, OfflineError } from '@/lib/api';
import { errorMessage, useAuth } from '@/lib/auth-context';
import { conversationTitle, shortWhen, type Conversation, type Message } from '@/lib/extras';

const REFRESH_MS = 15_000;

/** One conversation: newest at the bottom; checks for new messages every 15 s while open. */
export default function ConversationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user, request, accessToken } = useAuth();
  const insets = useSafeAreaInsets();
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [draft, setDraft] = useState('');
  const [urgent, setUrgent] = useState(false);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Last poll failed to reach the API — photos need a connection, so the button is disabled with a hint. */
  const [offline, setOffline] = useState(false);
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
      setOffline(false);
      if (m.data[0] && m.data[0].id !== newest.current) {
        newest.current = m.data[0].id;
        await request(`/messages/conversations/${id}/read`, { method: 'POST' }).catch(() => undefined);
      }
    } catch (e) {
      setError(errorMessage(e));
      if (e instanceof OfflineError) setOffline(true);
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

  /** Pick a photo, upload it to this conversation (multipart), then send a message carrying its documentId (D-089). */
  const sendPhoto = async () => {
    if (uploading || offline) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Photo access is off', 'Allow photo access in Settings to send photos in messages.');
      return;
    }
    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85 });
    const asset = picked.assets?.[0];
    if (picked.canceled || !asset) return;
    setUploading(true);
    setError(null);
    try {
      const token = await accessToken();
      if (!token) throw new ApiError(401, 'Your session has ended. Sign in again.');
      const form = new FormData();
      // React Native's FormData takes { uri, name, type } parts for files.
      form.append('file', { uri: asset.uri, name: asset.fileName ?? 'photo.jpg', type: asset.mimeType ?? 'image/jpeg' } as unknown as Blob);
      const uploaded = await fetch(`${API_URL}/messages/conversations/${id}/photos`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      }).catch(() => {
        throw new OfflineError();
      });
      const body = (await uploaded.json().catch(() => null)) as { success: boolean; data?: { id: string }; error?: { message: string } } | null;
      if (!uploaded.ok || !body?.success || !body.data) throw new ApiError(uploaded.status, body?.error?.message ?? 'Couldn’t send the photo.');
      const { data } = await request<Message>(`/messages/conversations/${id}/messages`, {
        method: 'POST',
        body: { content: draft.trim() || 'Sent a photo', isUrgent: urgent, documentId: body.data.id },
      });
      newest.current = data.id;
      setMessages((list) => [data, ...(list ?? [])]);
      setDraft('');
      setUrgent(false);
    } catch (e) {
      setError(errorMessage(e));
      if (e instanceof OfflineError) setOffline(true);
    } finally {
      setUploading(false);
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
                {item.document?.isPhoto && <MessagePhoto conversationId={id} documentId={item.document.id} mine={mine} />}
                {item.document && !item.document.isPhoto && (
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
            accessibilityRole="button"
            accessibilityLabel={offline ? 'Send a photo (needs a connection)' : 'Send a photo'}
            accessibilityHint={offline ? 'Photos need a connection; they can’t be sent offline.' : undefined}
            accessibilityState={{ disabled: offline || uploading, busy: uploading }}
            disabled={offline || uploading}
            onPress={() => void sendPhoto()}
            style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: offline || uploading ? '#e2e8f0' : colors.bg }}
          >
            <Ionicons name="camera-outline" size={24} color={offline || uploading ? '#94a3b8' : colors.brand} />
          </Pressable>
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

/** Blob → base64 data URL in memory only — photos are never written to this phone's storage. */
function toDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('read failed'));
    reader.readAsDataURL(blob);
  });
}

/** A photo sent in this conversation, fetched with the session token and held in memory (D-089). */
function MessagePhoto({ conversationId, documentId, mine }: { conversationId: string; documentId: string; mine: boolean }) {
  const { accessToken } = useAuth();
  const [uri, setUri] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const token = await accessToken();
      if (!token) throw new ApiError(401, 'Signed out');
      const res = await fetch(`${API_URL}/messages/conversations/${conversationId}/attachments/${documentId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new ApiError(res.status, 'Couldn’t load the photo.');
      const dataUrl = await toDataUrl(await res.blob());
      if (!cancelled) setUri(dataUrl);
    })().catch(() => {
      if (!cancelled) setFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [accessToken, conversationId, documentId]);

  if (failed) {
    return (
      <Text style={{ color: mine ? '#fecdd3' : colors.danger, fontSize: 13, marginTop: 4 }}>The photo couldn’t be loaded.</Text>
    );
  }
  if (!uri) {
    return <Text style={{ color: mine ? '#ddd6fe' : colors.muted, fontSize: 13, marginTop: 4 }}>Loading photo…</Text>;
  }
  return (
    <Image
      accessibilityLabel="Photo attached to this message"
      source={{ uri }}
      resizeMode="cover"
      style={{ width: 220, height: 220, borderRadius: 12, marginTop: 6, alignSelf: 'flex-start' }}
    />
  );
}
