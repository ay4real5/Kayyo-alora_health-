# Putting the caregiver app on phones

The app (`apps/mobile`, "Primordial Caregiver") is built with **EAS**, Expo's build service, so no Mac is needed.
The build profiles are in `apps/mobile/eas.json`. `preview` and `production` both point at
`https://api.primordialhealthservices.health/api/v1`.

App IDs (fixed once published, so don't change them after the first store upload):
`health.primordialhealthservices.caregiver` on both iOS and Android.

## Accounts (owner)

| Account | Cost | Needed for |
|---|---|---|
| [Expo](https://expo.dev/signup) | free (includes ~30 builds a month) | building the app |
| [Google Play Console](https://play.google.com/console/signup) | $25 once | Android phones (Play Store) |
| [Apple Developer Program](https://developer.apple.com/programs/enroll/) | $99 a year | iPhones (App Store / TestFlight) |

Enroll with Apple and Google **as the organization** (Primordial Health Services LLC). Apple then asks for a
**D-U-N-S number**, which is free from Dun & Bradstreet and takes a few days. Start that early.

## 1. Test on Android first (no store needed, ~20 minutes)

From the repo root on your computer:

```bash
npm install -g eas-cli
cd apps/mobile
eas login                 # your Expo account
eas init                  # links the app to your Expo account (adds a projectId to app.json; commit it)
eas build --profile preview --platform android
```

When the build finishes, EAS shows a link and a QR code. Open it on an Android phone to install the APK directly
(allow "install from this source" when asked). Sign in with a caregiver login you created in the dashboard.

## 2. Store releases

```bash
eas build --profile production --platform all
eas submit --platform android     # uploads to Play Console (first time: create the app there, internal testing track)
eas submit --platform ios         # uploads to App Store Connect → TestFlight
```

What the stores ask for:
- A **privacy policy URL**, e.g. a page on primordialhealthservices.health.
- The **data-safety / privacy answers**: location (only during a visit, for EVV), health data (entered by staff,
  encrypted, not shared or sold), and no ads or tracking.
- A **demo login** for the reviewers. Create a caregiver in a **test** agency with fake patients. Never give
  reviewers access to real patient data.

Use Play's **internal testing** track and Apple's **TestFlight** to give the app to your own staff first. A public
listing isn't needed: an agency app can stay "unlisted" or on internal testing.

## 3. Push notifications (after step 1)

- API App Settings: `PUSH_PROVIDER=expo`, plus `EXPO_ACCESS_TOKEN` (expo.dev → Account settings → Access tokens).
  Push text never contains patient details (D-071).
- **Android** needs a Firebase project. The owner created `primordial-8c9f0` on the free Spark plan, which is used
  **only** to deliver notifications (D-091). Two pieces are needed:
  - `google-services.json` (app config, not secret) is kept out of git. It sits at `apps/mobile/google-services.json`
    for local builds, and EAS builds get it from the project file variable `GOOGLE_SERVICES_JSON` (preview +
    production), wired up in `app.config.ts`.
  - The **FCM V1 service account key** (secret) is uploaded by the owner at expo.dev → project → Credentials →
    Android → FCM V1. It never goes in the repo or the chat.
- iOS push keys are created automatically by `eas build` once the Apple account exists.

## Updating the app

Bump `version` in `apps/mobile/app.json` for a visible release. The build numbers increase on their own
(`autoIncrement`). Then run `eas build --profile production` and `eas submit` again.
