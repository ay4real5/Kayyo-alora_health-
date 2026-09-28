import { MANDATORY_TWO_FACTOR_ROLES } from '@alora/shared';
import type { PrismaService } from '../../../database/prisma.service.js';

/**
 * Whether the user holds a role that must use 2FA (D-045), and whether they have it on. Read fresh from the
 * database whenever tokens are issued, so enabling 2FA (then refreshing) lifts the restriction immediately.
 */
export async function twoFactorPolicy(
  prisma: PrismaService,
  userId: string,
): Promise<{ mandatory: boolean; enabled: boolean }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { is2faEnabled: true, userRoles: { select: { role: { select: { name: true, agencyId: true } } } } },
  });
  const mandatory = Boolean(
    user?.userRoles.some(
      (ur) => ur.role.agencyId === null && (MANDATORY_TWO_FACTOR_ROLES as readonly string[]).includes(ur.role.name),
    ),
  );
  return { mandatory, enabled: Boolean(user?.is2faEnabled) };
}
