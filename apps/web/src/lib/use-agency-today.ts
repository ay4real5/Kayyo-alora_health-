import { todayInTimeZone } from '@alora/shared';
import { useAuth } from './auth/auth-provider';

/**
 * Today's date (YYYY-MM-DD) in the agency's timezone — the calendar the API and scheduling use — rather than
 * the browser's clock, which may be in another timezone.
 */
export function useAgencyToday(): string {
  const { user } = useAuth();
  return todayInTimeZone(user?.agencyTimezone ?? 'America/New_York');
}
