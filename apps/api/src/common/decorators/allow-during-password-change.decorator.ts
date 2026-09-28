import { SetMetadata } from '@nestjs/common';

export const ALLOW_DURING_PASSWORD_CHANGE_KEY = 'allowDuringPasswordChange';

/**
 * Marks a route a user may use while their password change is forced (P4-09): who am I, change password.
 * Every other route answers 403 PASSWORD_CHANGE_REQUIRED for them.
 */
export const AllowDuringPasswordChange = () => SetMetadata(ALLOW_DURING_PASSWORD_CHANGE_KEY, true);
