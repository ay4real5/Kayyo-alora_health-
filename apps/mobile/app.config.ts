import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Adds the Firebase config Android needs for push notifications (D-091) on top of app.json, without committing it:
 * EAS builds get it from the GOOGLE_SERVICES_JSON file variable, local builds from ./google-services.json (gitignored).
 */
export default ({ config }: ConfigContext): ExpoConfig => ({
  ...(config as ExpoConfig),
  android: {
    ...config.android,
    googleServicesFile: process.env.GOOGLE_SERVICES_JSON ?? './google-services.json',
  },
});
