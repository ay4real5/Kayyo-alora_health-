import { DEFAULT_DELIVERY_CHANNELS, type DeliveryChannel, type NotificationType } from '@alora/shared';

/**
 * Which channels outside the app a notification goes to for one person (D-071). Pure; the service gathers the facts.
 */
export interface DeliveryFacts {
  type: NotificationType;
  /** The person's saved choices for this type; null/undefined fields = the type's default. */
  preference: { channelPush?: boolean | null; channelSms?: boolean | null; channelEmail?: boolean | null } | null;
  /** Channels the agency has connected (settings present). */
  available: Record<DeliveryChannel, boolean>;
  recipient: {
    isActive: boolean;
    /** Patients/families (portal users) get in-app only until the providers' BAAs cover them — a text or email to
     *  a patient itself reveals they're a patient. */
    isPortalUser: boolean;
    hasPhone: boolean;
    hasEmail: boolean;
    pushDevices: number;
  };
}

export function effectiveChannel(
  type: NotificationType,
  channel: DeliveryChannel,
  preference: DeliveryFacts['preference'],
): boolean {
  const saved = channel === 'push' ? preference?.channelPush : channel === 'sms' ? preference?.channelSms : preference?.channelEmail;
  return saved ?? DEFAULT_DELIVERY_CHANNELS[type].includes(channel);
}

export function plannedChannels(f: DeliveryFacts): DeliveryChannel[] {
  const r = f.recipient;
  if (!r.isActive || r.isPortalUser) return [];
  const reachable: Record<DeliveryChannel, boolean> = { push: r.pushDevices > 0, sms: r.hasPhone, email: r.hasEmail };
  return (['push', 'sms', 'email'] as const).filter(
    (channel) => f.available[channel] && reachable[channel] && effectiveChannel(f.type, channel, f.preference),
  );
}

/** Minutes to wait before attempt n+1 after n failed attempts; after the last, the delivery is given up. */
export const RETRY_DELAYS_MINUTES = [1, 5, 30, 120] as const;
export const MAX_ATTEMPTS = RETRY_DELAYS_MINUTES.length + 1;
/** A notification older than this isn't worth sending any more (a shift reminder a day late is noise). */
export const DELIVERY_MAX_AGE_HOURS = 24;
