import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import type { ApiResult, RequestOptions } from './api';
import { reminderId } from './reminders';

type Request = <T>(path: string, options?: Omit<RequestOptions, 'accessToken'>) => Promise<ApiResult<T>>;

let ready: Promise<boolean> | null = null;

/** Asks once (at the first clock-in) and sets up how reminders show. Returns whether reminders are allowed. */
function prepare(): Promise<boolean> {
  ready ??= (async () => {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('visit-reminders', {
        name: 'Visit reminders',
        importance: Notifications.AndroidImportance.HIGH,
      });
    }
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;
    return (await Notifications.requestPermissionsAsync()).granted;
  })();
  return ready;
}

/**
 * A local reminder on this phone to clock out (DECISIONS D-049). No patient details in the text — lock screens are
 * visible to anyone nearby. Works offline and without push services.
 */
export async function scheduleClockOutReminder(visitId: string, at: Date): Promise<void> {
  try {
    if (!(await remindersEnabled()) || !(await prepare())) return;
    await Notifications.cancelScheduledNotificationAsync(reminderId(visitId)).catch(() => undefined);
    await Notifications.scheduleNotificationAsync({
      identifier: reminderId(visitId),
      content: {
        title: 'Still on a visit?',
        body: 'Your visit was scheduled to end. Remember to clock out in Kayo Health.',
        data: { visitId },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: at,
        ...(Platform.OS === 'android' ? { channelId: 'visit-reminders' } : {}),
      },
    });
  } catch {
    // A reminder is a convenience; never let it break clocking in.
  }
}

export async function cancelClockOutReminder(visitId: string): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(reminderId(visitId)).catch(() => undefined);
}

/** Sign-out: nothing of this caregiver's should fire for the next person. */
export async function cancelAllReminders(): Promise<void> {
  await Notifications.cancelAllScheduledNotificationsAsync().catch(() => undefined);
}

let pushToken: string | null = null;

/**
 * Registers this phone for push notifications (D-071) — only when the app was built with an Expo project id (EAS)
 * and the person already allowed notifications (they're asked at the first clock-in). Push texts carry no PHI; the
 * app loads details after sign-in. Failures are ignored: in-app alerts still work.
 */
export async function registerForPush(request: Request): Promise<void> {
  try {
    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId || Platform.OS === 'web') return;
    if (!(await Notifications.getPermissionsAsync()).granted) return;
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await request('/notifications/devices', { method: 'POST', body: { token, platform: Platform.OS } });
    pushToken = token;
  } catch {
    // Push is a convenience.
  }
}

/** Sign-out: this phone stops getting the person's alerts (called while the session is still valid). */
export async function unregisterForPush(request: Request): Promise<void> {
  const token = pushToken;
  pushToken = null;
  if (!token) return;
  await request(`/notifications/devices/${encodeURIComponent(token)}`, { method: 'DELETE' }).catch(() => undefined);
}

const REMINDERS_KEY = 'kayo.visitReminders';

/** The caregiver's choice (Profile → Visit reminders), on unless switched off. Kept on this phone only. */
export async function remindersEnabled(): Promise<boolean> {
  return (await SecureStore.getItemAsync(REMINDERS_KEY).catch(() => null)) !== 'off';
}

export async function setRemindersEnabled(on: boolean): Promise<void> {
  await SecureStore.setItemAsync(REMINDERS_KEY, on ? 'on' : 'off').catch(() => undefined);
  if (!on) await Notifications.cancelAllScheduledNotificationsAsync().catch(() => undefined);
}
