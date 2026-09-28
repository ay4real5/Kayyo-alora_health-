/**
 * Whether the user must choose a new password before doing anything (D-020 password age, D-058/P4-09):
 * a never-set password (e.g. an admin-created account) always counts; PASSWORD_MAX_AGE_DAYS = 0 turns the
 * age check off.
 */
export function passwordChangeRequired(changedAt: Date | null, maxAgeDays: number, now = Date.now()): boolean {
  if (maxAgeDays === 0) return false;
  if (!changedAt) return true;
  return now - changedAt.getTime() > maxAgeDays * 24 * 60 * 60_000;
}
