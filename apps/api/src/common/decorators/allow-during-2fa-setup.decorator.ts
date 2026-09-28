import { SetMetadata } from '@nestjs/common';

export const ALLOW_DURING_2FA_SETUP_KEY = 'allowDuring2faSetup';

/**
 * Marks a route an admin may use before setting up mandatory 2FA (D-045): who am I, set up / enable 2FA, change
 * password. Every other route answers 403 TWO_FACTOR_SETUP_REQUIRED for them.
 */
export const AllowDuringTwoFactorSetup = () => SetMetadata(ALLOW_DURING_2FA_SETUP_KEY, true);
