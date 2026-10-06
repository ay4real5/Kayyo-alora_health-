import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { colors, type IconName } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';

const TAB_ICONS: Record<string, [IconName, IconName]> = {
  index: ['today', 'today-outline'],
  schedule: ['calendar', 'calendar-outline'],
  messages: ['chatbubbles', 'chatbubbles-outline'],
  alerts: ['notifications', 'notifications-outline'],
  profile: ['person-circle', 'person-circle-outline'],
};

const UNREAD_POLL_MS = 60_000;

/** The caregiver's main tabs (D-080, D-083): Today, Schedule, Messages, Alerts, Profile. */
export default function TabsLayout() {
  const { request } = useAuth();
  const [unread, setUnread] = useState(0);

  // Unread messages for the tab badge: every minute, and whenever a tab is opened.
  const refreshUnread = useCallback(() => {
    request<{ unread: number }>('/messages/unread-count')
      .then(({ data }) => setUnread(data.unread))
      .catch(() => undefined);
  }, [request]);
  useEffect(() => {
    refreshUnread();
    const timer = setInterval(refreshUnread, UNREAD_POLL_MS);
    return () => clearInterval(timer);
  }, [refreshUnread]);

  return (
    <Tabs
      screenListeners={{ focus: refreshUnread }}
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: '#7c8497',
        tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
        tabBarStyle: { borderTopColor: colors.border, backgroundColor: colors.white, height: 64, paddingTop: 6, paddingBottom: 8 },
        tabBarBadgeStyle: { backgroundColor: '#ef5a46', fontSize: 11 },
        tabBarIcon: ({ focused, color, size }) => {
          const [on, off] = TAB_ICONS[route.name] ?? ['ellipse', 'ellipse-outline'];
          return <Ionicons name={focused ? on : off} size={size} color={color} />;
        },
      })}
    >
      <Tabs.Screen name="index" options={{ title: 'Today' }} />
      <Tabs.Screen name="schedule" options={{ title: 'Schedule' }} />
      <Tabs.Screen name="messages" options={{ title: 'Messages', tabBarBadge: unread > 0 ? (unread > 99 ? '99+' : unread) : undefined }} />
      <Tabs.Screen name="alerts" options={{ title: 'Alerts' }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile' }} />
    </Tabs>
  );
}
