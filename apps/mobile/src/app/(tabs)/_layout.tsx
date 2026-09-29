import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { colors, type IconName } from '@/components/ui';

const TAB_ICONS: Record<string, [IconName, IconName]> = {
  index: ['today', 'today-outline'],
  schedule: ['calendar', 'calendar-outline'],
  alerts: ['notifications', 'notifications-outline'],
  profile: ['person-circle', 'person-circle-outline'],
};

/** The caregiver's main tabs (D-080): Today, Schedule, Alerts, Profile. */
export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: '#7c8497',
        tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
        tabBarStyle: { borderTopColor: colors.border, backgroundColor: colors.white, height: 64, paddingTop: 6, paddingBottom: 8 },
        tabBarIcon: ({ focused, color, size }) => {
          const [on, off] = TAB_ICONS[route.name] ?? ['ellipse', 'ellipse-outline'];
          return <Ionicons name={focused ? on : off} size={size} color={color} />;
        },
      })}
    >
      <Tabs.Screen name="index" options={{ title: 'Today' }} />
      <Tabs.Screen name="schedule" options={{ title: 'Schedule' }} />
      <Tabs.Screen name="alerts" options={{ title: 'Alerts' }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile' }} />
    </Tabs>
  );
}
