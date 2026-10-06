import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar, Card, ErrorText, GradientHeader, colors, styles } from '@/components/ui';
import { errorMessage, useAuth } from '@/lib/auth-context';
import { conversationTitle, shortWhen, type Conversation } from '@/lib/extras';

/**
 * Secure messages with the office and colleagues (D-057, D-083). Needs a connection: message text is never saved on
 * the phone.
 */
export default function MessagesScreen() {
  const { user, request } = useAuth();
  const insets = useSafeAreaInsets();
  const [list, setList] = useState<Conversation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setList((await request<Conversation[]>('/messages/conversations?limit=50')).data);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [request]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (!user) return null;
  const unread = list?.reduce((n, c) => n + c.unread, 0) ?? 0;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <GradientHeader style={{ paddingTop: insets.top + 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <View>
            <Text style={{ color: colors.white, fontSize: 26, fontWeight: '800' }}>Messages</Text>
            <Text style={{ color: '#9aeedd', fontSize: 15, marginTop: 4 }}>{unread ? `${unread} unread` : 'Secure, just for your team'}</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="New message"
            onPress={() => router.push('/messages/new')}
            style={{ backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, flexDirection: 'row', gap: 6, alignItems: 'center' }}
          >
            <Ionicons name="create-outline" size={18} color={colors.white} />
            <Text style={{ color: colors.white, fontWeight: '700' }}>New</Text>
          </Pressable>
        </View>
      </GradientHeader>
      <FlatList
        data={list ?? []}
        keyExtractor={(c) => c.id}
        contentContainerStyle={{ padding: 20, gap: 10, paddingBottom: 32 }}
        refreshControl={
          <RefreshControl
            tintColor={colors.brand}
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
          />
        }
        ListHeaderComponent={<ErrorText>{error}</ErrorText>}
        ListEmptyComponent={
          list ? (
            <Card style={{ alignItems: 'center', paddingVertical: 28, gap: 8 }}>
              <Ionicons name="chatbubbles-outline" size={34} color={colors.brand} />
              <Text style={{ fontSize: 17, fontWeight: '700', color: colors.text }}>No messages yet</Text>
              <Text style={[styles.subtitle, { textAlign: 'center' }]}>Tap New to message your office or a colleague.</Text>
            </Card>
          ) : null
        }
        renderItem={({ item }) => {
          const title = conversationTitle(item, user.id);
          const other = item.participants.find((p) => p.id !== user.id) ?? item.participants[0];
          const last = item.lastMessage;
          const preview = last ? `${last.sender.id === user.id ? 'You: ' : ''}${last.content}` : 'No messages yet';
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${title}${item.unread ? `, ${item.unread} unread` : ''}`}
              onPress={() => router.push({ pathname: '/messages/[id]', params: { id: item.id } })}
              style={({ pressed }) => pressed && { opacity: 0.75 }}
            >
              <Card style={[{ flexDirection: 'row', alignItems: 'center', gap: 12 }, item.unread > 0 && { borderWidth: 1, borderColor: '#9aeedd' }]}>
                {item.type === 'direct' && other ? (
                  <Avatar first={other.firstName} last={other.lastName} size={46} />
                ) : (
                  <View style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: colors.brandSoft, alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name="people" size={22} color={colors.brand} />
                  </View>
                )}
                <View style={{ flex: 1, gap: 2 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text numberOfLines={1} style={{ flex: 1, fontSize: 16, fontWeight: item.unread ? '800' : '600', color: colors.text }}>
                      {title}
                    </Text>
                    {item.lastMessageAt && <Text style={{ fontSize: 12, color: colors.muted }}>{shortWhen(item.lastMessageAt)}</Text>}
                  </View>
                  {item.patient && (
                    <Text numberOfLines={1} style={{ fontSize: 13, color: colors.brandDark, fontWeight: '600' }}>
                      About {item.patient.firstName} {item.patient.lastName}
                    </Text>
                  )}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    {last?.isUrgent && <Ionicons name="alert-circle" size={15} color={colors.danger} />}
                    <Text numberOfLines={1} style={{ flex: 1, fontSize: 14, color: colors.muted }}>
                      {preview}
                    </Text>
                    {item.unread > 0 && (
                      <View style={{ minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, backgroundColor: '#ef5a46', alignItems: 'center', justifyContent: 'center' }}>
                        <Text style={{ color: colors.white, fontSize: 12, fontWeight: '800' }}>{item.unread}</Text>
                      </View>
                    )}
                  </View>
                </View>
              </Card>
            </Pressable>
          );
        }}
      />
    </View>
  );
}
