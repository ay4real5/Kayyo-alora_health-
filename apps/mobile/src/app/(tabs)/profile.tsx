import Constants from 'expo-constants';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Linking, ScrollView, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar, Button, Card, ErrorText, GradientHeader, ListRow, Pill, SectionTitle, colors } from '@/components/ui';
import { errorMessage, useAuth } from '@/lib/auth-context';
import { remindersEnabled, setRemindersEnabled } from '@/lib/notifications';
import { useOffline } from '@/lib/offline';
import { humanize } from '@/lib/visits';

interface StaffMe {
  id: string;
  employeeId: string | null;
  discipline: string;
  employmentType: string;
  email: string;
  phone: string | null;
  hireDate: string | null;
  hasPhoneCheckInCode: boolean;
}

interface Credential {
  id: string;
  credentialName: string;
  expiryDate: string | null;
  state: 'valid' | 'expiring_soon' | 'expired' | 'no_expiry';
}

const CREDENTIAL_PILL: Record<Credential['state'], [string, string]> = {
  valid: ['completed', 'Valid'],
  expiring_soon: ['in_progress', 'Expiring soon'],
  expired: ['missed', 'Expired'],
  no_expiry: ['cancelled', 'No expiry'],
};

interface Recognition {
  enabled: boolean;
  badges: { key: string; title: string; description: string }[];
}

interface Onboarding {
  percent: number;
  ready: boolean;
  items: { key: string; label: string; done: boolean; required: boolean; owner: 'caregiver' | 'office' }[];
}

const BADGE_ICONS: Record<string, 'trophy-outline' | 'time-outline' | 'document-text-outline' | 'location-outline'> = {
  perfect_attendance: 'trophy-outline',
  always_on_time: 'time-outline',
  note_pro: 'document-text-outline',
  gps_star: 'location-outline',
};

const date = (d: string | null) =>
  d ? new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : null;

/** The caregiver's profile, credentials, settings and help (D-080). */
export default function ProfileScreen() {
  const { user, request } = useAuth();
  const { ops, signOut } = useOffline();
  const insets = useSafeAreaInsets();
  const [staff, setStaff] = useState<StaffMe | null>(null);
  const [credentials, setCredentials] = useState<Credential[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reminders, setReminders] = useState(true);
  const [recognition, setRecognition] = useState<Recognition | null>(null);
  const [onboarding, setOnboarding] = useState<Onboarding | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const me = (await request<StaffMe>('/staff/me')).data;
      setStaff(me);
      setCredentials((await request<Credential[]>(`/staff/${me.id}/credentials`)).data);
      // Badges (D-097) are optional extras: never let them break the profile.
      request<Recognition>('/insights/my-recognition')
        .then(({ data }) => setRecognition(data))
        .catch(() => setRecognition(null));
      request<Onboarding | null>('/staff/me/onboarding')
        .then(({ data }) => setOnboarding(data))
        .catch(() => setOnboarding(null));
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [request]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );
  useEffect(() => {
    void remindersEnabled().then(setReminders);
  }, []);

  if (!user) return null;
  const role = humanize(user.roles.find((r) => r !== 'portal_user') ?? 'caregiver');
  const officePhone = user.agency?.phone ?? null;
  const unsent = ops.filter((op) => !op.failure).length;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ paddingBottom: 40 }}>
      <GradientHeader style={{ paddingTop: insets.top + 24, alignItems: 'center', paddingBottom: 32 }}>
        <Avatar first={user.firstName} last={user.lastName} size={84} />
        <Text style={{ color: colors.white, fontSize: 24, fontWeight: '800', marginTop: 12 }}>
          {user.firstName} {user.lastName}
        </Text>
        <Text style={{ color: '#c7d2fe', fontSize: 15, marginTop: 2 }}>
          {staff ? `${staff.discipline} · ${role}` : role}
        </Text>
        {user.agency?.name ? <Text style={{ color: '#a5b4fc', fontSize: 13, marginTop: 4 }}>{user.agency.name}</Text> : null}
      </GradientHeader>

      <View style={{ padding: 20, gap: 12 }}>
        <ErrorText>{error}</ErrorText>

        <SectionTitle>My details</SectionTitle>
        <Card style={{ paddingVertical: 4 }}>
          <ListRow icon="id-card-outline" label="Employee ID" value={staff?.employeeId ?? (staff ? 'Not set' : '…')} />
          <ListRow icon="briefcase-outline" label="Employment" value={staff ? humanize(staff.employmentType) : '…'} />
          <ListRow icon="mail-outline" label="Email" value={staff?.email ?? '…'} />
          <ListRow icon="call-outline" label="Phone" value={staff ? (staff.phone ?? 'Not set') : '…'} />
          <ListRow
            icon="keypad-outline"
            label="Phone check-in code"
            value={staff ? (staff.hasPhoneCheckInCode ? 'Set' : 'Ask your office') : '…'}
            last
          />
        </Card>

        <Card style={{ paddingVertical: 4 }}>
          <ListRow icon="wallet-outline" label="My pay" onPress={() => router.push('/pay')} />
          <ListRow icon="briefcase-outline" label="Open shifts" onPress={() => router.push('/open-shifts')} />
          <ListRow icon="navigate-outline" label="Mileage" onPress={() => router.push('/mileage')} />
          <ListRow icon="airplane-outline" label="Time off" onPress={() => router.push('/time-off')} last />
        </Card>

        {onboarding && !onboarding.ready && (
          <>
            <SectionTitle>Getting started — {onboarding.percent}% ready</SectionTitle>
            <Card style={{ paddingVertical: 4 }}>
              {onboarding.items
                .filter((i) => i.required && !i.done)
                .map((i, n, list) => (
                  <ListRow key={i.key} icon="ellipse-outline" label={i.label} value={i.owner === 'office' ? 'Your office adds this' : 'For you to do'} last={n === list.length - 1} />
                ))}
            </Card>
          </>
        )}

        {recognition?.enabled && recognition.badges.length > 0 && (
          <>
            <SectionTitle>My badges</SectionTitle>
            <Card style={{ paddingVertical: 4 }}>
              {recognition.badges.map((b, i) => (
                <ListRow key={b.key} icon={BADGE_ICONS[b.key] ?? 'star-outline'} label={b.title} value={b.description} last={i === recognition.badges.length - 1} />
              ))}
            </Card>
          </>
        )}

        <SectionTitle>Credentials</SectionTitle>
        <Card style={{ paddingVertical: credentials?.length ? 4 : 16 }}>
          {credentials?.length === 0 && <Text style={{ color: colors.muted, fontSize: 15 }}>No credentials on file.</Text>}
          {credentials?.map((c, i) => {
            const [status, label] = CREDENTIAL_PILL[c.state];
            return (
              <ListRow
                key={c.id}
                icon="ribbon-outline"
                label={c.credentialName}
                value={c.expiryDate ? date(c.expiryDate) : null}
                right={<Pill status={status} label={label} />}
                last={i === credentials.length - 1}
              />
            );
          })}
          {!credentials && !error && <Text style={{ color: colors.muted, fontSize: 15 }}>Loading…</Text>}
        </Card>

        <SectionTitle>Settings</SectionTitle>
        <Card style={{ paddingVertical: 4 }}>
          <ListRow
            icon="alarm-outline"
            label="Visit reminders"
            right={
              <Switch
                accessibilityLabel="Visit reminders"
                value={reminders}
                trackColor={{ true: colors.brand, false: '#cbd5e1' }}
                thumbColor={colors.white}
                onValueChange={(on) => {
                  setReminders(on);
                  void setRemindersEnabled(on);
                }}
              />
            }
          />
          <ListRow icon="lock-closed-outline" label="App lock" value="After 5 min away" />
          <ListRow icon="key-outline" label="Change password" onPress={() => router.push('/password')} last />
        </Card>

        <SectionTitle>Help</SectionTitle>
        <Card style={{ paddingVertical: 4 }}>
          {officePhone ? (
            <ListRow icon="call" label="Call the office" value={officePhone} onPress={() => void Linking.openURL(`tel:${officePhone.replace(/[^\d+]/g, '')}`)} />
          ) : (
            <ListRow icon="call" label="Call the office" value="Number not set" />
          )}
          <ListRow icon="cloud-upload-outline" label="Waiting to send" value={unsent ? `${unsent} item${unsent === 1 ? '' : 's'}` : 'Nothing'} />
          <ListRow icon="information-circle-outline" label="App version" value={Constants.expoConfig?.version ?? '—'} last />
        </Card>

        <View style={{ marginTop: 8 }}>
          <Button title="Sign out" variant="danger" icon="log-out-outline" onPress={signOut} />
        </View>
        <Text style={{ textAlign: 'center', color: colors.muted, fontSize: 13, marginTop: 4 }}>Primordial Health · Caregiver</Text>
      </View>
    </ScrollView>
  );
}
