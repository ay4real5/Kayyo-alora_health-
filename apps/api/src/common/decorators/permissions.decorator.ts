import { SetMetadata } from '@nestjs/common';
import type { Permission } from '@alora/shared';

export const PERMISSIONS_KEY = 'requiredPermissions';

/**
 * The caller needs ALL listed permissions (from their roles in their own agency). Put this on every route
 * that touches PHI or agency data. Routes without it only require a logged-in user (e.g. /auth/me).
 */
export const Permissions = (...permissions: [Permission, ...Permission[]]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
