import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { Avatar, Button, Card, ErrorText, colors, styles } from '@/components/ui';
import { errorMessage, useAuth } from '@/lib/auth-context';
import type { Conversation } from '@/lib/extras';
import { humanize } from '@/lib/visits';

interface Contact {
  id: string;
  firstName: string;
  lastName: string;
  roles: string[];
}

/** Pick a colleague and send the first message (the API reuses an existing one-to-one thread). */
export default function NewMessageScreen() {
  const { request } = useAuth();
  const [search, setSearch] = useState('');
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [to, setTo] = useState<Contact | null>(null);
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      const q = search.trim();
      request<Contact[]>(`/messages/contacts${q ? `?search=${encodeURIComponent(q)}` : ''}`)
        .then(({ data }) => {
          setContacts(data);
          setError(null);
        })
        .catch((e: unknown) => setError(errorMessage(e)));
    }, 250);
    return () => clearTimeout(timer);
  }, [request, search]);

  const send = async () => {
    if (!to || !content.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const { data } = await request<Conversation>('/messages/conversations', {
        method: 'POST',
        body: { participantIds: [to.id], content: content.trim() },
      });
      router.replace({ pathname: '/messages/[id]', params: { id: data.id } });
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  if (to) {
    return (
      <View style={styles.screen}>
        <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Avatar first={to.firstName} last={to.lastName} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 17, fontWeight: '700', color: colors.text }}>
              {to.firstName} {to.lastName}
            </Text>
            <Text style={{ color: colors.muted }}>{to.roles.map(humanize).join(', ')}</Text>
          </View>
          <Pressable accessibilityRole="button" onPress={() => setTo(null)}>
            <Text style={{ color: colors.brand, fontWeight: '700' }}>Change</Text>
          </Pressable>
        </Card>
        <Text style={styles.label}>Message</Text>
        <TextInput
          accessibilityLabel="Message"
          value={content}
          onChangeText={setContent}
          multiline
          maxLength={5000}
          autoFocus
          style={[styles.input, { minHeight: 120, textAlignVertical: 'top' }]}
        />
        <ErrorText>{error}</ErrorText>
        <Button title="Send" icon="send" busy={busy} onPress={() => void send()} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ padding: 20, paddingBottom: 8 }}>
        <TextInput
          accessibilityLabel="Search people"
          placeholder="Search by name"
          placeholderTextColor="#8a93a6"
          value={search}
          onChangeText={setSearch}
          autoFocus
          style={styles.input}
        />
      </View>
      <FlatList
        data={contacts ?? []}
        keyExtractor={(c) => c.id}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32, gap: 8 }}
        ListHeaderComponent={<ErrorText>{error}</ErrorText>}
        ListEmptyComponent={contacts ? <Text style={{ color: colors.muted, textAlign: 'center', marginTop: 20 }}>No one found.</Text> : null}
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${item.firstName} ${item.lastName}`}
            onPress={() => setTo(item)}
            style={({ pressed }) => pressed && { opacity: 0.7 }}
          >
            <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Avatar first={item.firstName} last={item.lastName} size={40} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 16, fontWeight: '600', color: colors.text }}>
                  {item.firstName} {item.lastName}
                </Text>
                <Text style={{ color: colors.muted, fontSize: 13 }}>{item.roles.map(humanize).join(', ')}</Text>
              </View>
            </Card>
          </Pressable>
        )}
      />
    </View>
  );
}
