import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { reminderId } from './reminders';

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
    if (!(await prepare())) return;
    await Notifications.cancelScheduledNotificationAsync(reminderId(visitId)).catch(() => undefined);
    await Notifications.scheduleNotificationAsync({
      identifier: reminderId(visitId),
      content: {
        title: 'Still on a visit?',
        body: 'Your visit was scheduled to end. Remember to clock out in Alora.',
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
