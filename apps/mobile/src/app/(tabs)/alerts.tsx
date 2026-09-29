import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect, type Href } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Card, ErrorText, GradientHeader, colors, styles, type IconName } from '@/components/ui';
import { errorMessage, useAuth } from '@/lib/auth-context';

interface Alert {
  id: string;
  type: string;
  title: string;
  body: string | null;
  isRead: boolean;
  createdAt: string;
}

const ICONS: Record<string, IconName> = {
  shift_assigned: 'calendar',
  shift_updated: 'create',
  shift_cancelled: 'close-circle',
  shift_unassigned: 'remove-circle',
  shift_reminder: 'alarm',
  open_shift: 'megaphone',
  swap_requested: 'swap-horizontal',
  swap_decided: 'swap-horizontal',
  message_received: 'chatbubble-ellipses',
  credential_expiry: 'ribbon',
  payroll_ready: 'cash',
  time_off_decided: 'airplane',
  evv_correction_decided: 'time',
  system: 'shield-checkmark',
};

/** Where tapping an alert goes (alerts carry no patient details, so they link to screens, not records). */
const TARGETS: Record<string, Href> = {
  open_shift: '/open-shifts',
  message_received: '/messages',
  payroll_ready: '/pay',
  shift_assigned: '/schedule',
  shift_updated: '/schedule',
  shift_reminder: '/',
};

/** "5 min ago", "3 h ago", or a date. */
function ago(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)} h ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** The caregiver's alerts (the same inbox as the dashboard bell). Alerts never include patient details. */
export default function AlertsScreen() {
  const { request } = useAuth();
  const insets = useSafeAreaInsets();
  const [alerts, setAlerts] = useState<Alert[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setAlerts((await request<Alert[]>('/notifications?limit=50')).data);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [request]);

  // Reload whenever the tab is opened.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const markRead = async (id: string) => {
    setAlerts((list) => list?.map((a) => (a.id === id ? { ...a, isRead: true } : a)) ?? null);
    await request(`/notifications/${id}/read`, { method: 'PATCH' }).catch(() => undefined);
  };
  const markAll = async () => {
    setAlerts((list) => list?.map((a) => ({ ...a, isRead: true })) ?? null);
    await request('/notifications/mark-all-read', { method: 'POST' }).catch(() => undefined);
  };
  const unread = alerts?.filter((a) => !a.isRead).length ?? 0;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <GradientHeader style={{ paddingTop: insets.top + 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <View>
            <Text style={{ color: colors.white, fontSize: 26, fontWeight: '800' }}>Alerts</Text>
            <Text style={{ color: '#c7d2fe', fontSize: 15, marginTop: 4 }}>{unread ? `${unread} unread` : 'You’re all caught up'}</Text>
          </View>
          {unread > 0 && (
            <Pressable accessibilityRole="button" onPress={() => void markAll()} style={{ backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 }}>
              <Text style={{ color: colors.white, fontWeight: '700' }}>Mark all read</Text>
            </Pressable>
          )}
        </View>
      </GradientHeader>
      <FlatList
        data={alerts ?? []}
        keyExtractor={(a) => a.id}
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
          alerts ? (
            <Card style={{ alignItems: 'center', paddingVertical: 28, gap: 8 }}>
              <Ionicons name="notifications-off-outline" size={34} color={colors.brand} />
              <Text style={{ fontSize: 17, fontWeight: '700', color: colors.text }}>No alerts</Text>
              <Text style={styles.subtitle}>New shifts, changes and messages show up here.</Text>
            </Card>
          ) : null
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${item.isRead ? '' : 'Unread. '}${item.title}${item.body ? `. ${item.body}` : ''}`}
            onPress={() => {
              if (!item.isRead) void markRead(item.id);
              const target = TARGETS[item.type];
              if (target) router.push(target);
            }}
          >
            <Card style={[{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }, !item.isRead && { borderWidth: 1, borderColor: '#ddd6fe' }]}>
              <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: colors.brandSoft, alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name={ICONS[item.type] ?? 'notifications'} size={20} color={colors.brand} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ fontSize: 16, fontWeight: item.isRead ? '600' : '800', color: colors.text }}>{item.title}</Text>
                {item.body ? <Text style={{ fontSize: 14, color: colors.muted }}>{item.body}</Text> : null}
                <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>{ago(item.createdAt)}</Text>
              </View>
              {!item.isRead && <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: '#c026d3', marginTop: 6 }} />}
            </Card>
          </Pressable>
        )}
      />
    </View>
  );
}
