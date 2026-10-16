# Daymark native mobile app (Capacitor)

Daymark keeps the React/Vite web app and wraps the same built UI in native Android/iOS shells using Capacitor. It continues to use the existing Supabase project; do not create a second backend.

## Offline reminders: what they mean

The installed mobile app uses the operating system's local-notification scheduler. When Daymark is online and open, it schedules upcoming reminders onto the device. The OS can then deliver those reminders with the app closed and without mobile data/Wi-Fi. Cloud updates from another device cannot reach an offline phone until it reconnects, so the local schedule is based on the most recently synced copy.

For cross-platform reliability, Daymark keeps a rolling queue of up to 60 upcoming reminders (under the current iOS pending-local-notification budget). It reconciles this queue at startup, whenever the app returns to the foreground, and whenever schedule/preferences change. Open the app periodically while connected so the local queue can be refreshed with cloud changes. Notification permission must be granted and system Focus/Do Not Disturb settings can still suppress alerts. Android exact timing may require the user to allow Alarms & reminders; battery/vendor restrictions can delay some alarms.

Cloud/Web Push remains a separate mechanism and needs a network to receive a remote push. It is not the mechanism used for native offline local reminders.

## Build Android locally

Requirements: Node.js 22+, Android Studio, Android SDK, and JDK 21.

1. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `.env.local` (copy `.env.example`; never use a Supabase secret/service-role key).
2. `npm install`
3. `npm run build`
4. `npm run cap:init:android` (once per checkout)
5. `npm run cap:sync:android`
6. `npm run cap:open:android`, then run on a device/emulator from Android Studio.

The patch script adds Android notification permission declarations, the status-bar icon, and the OAuth deep-link filter. On Android 13+, allow notifications. On Android 12+, Daymark may need the OS's **Alarms & reminders** permission for precise notification timing. If exact alarm permission is not allowed, delivery timing can be delayed by Android.

## Build APK through GitHub Actions

1. In the GitHub repo, go to **Settings → Secrets and variables → Actions → Variables**.
2. Add repository variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. The publishable/anon key is client-safe when RLS is configured; never add a database password, service-role key, or Google OAuth client secret here.
3. Commit and push this project. Open the **Actions** tab, select **Build Android APK**, and choose **Run workflow** if it has not run automatically. The workflow installs Android API 36/build-tools, builds a debug APK, and uploads it as an artifact; GitHub must be able to download npm dependencies for this job to complete.
4. When successful, download the `daymark-android-debug-apk` artifact, extract `app-debug.apk`, and install it on your Android device (you may need to allow installs from the browser/files app). This is a debug APK for personal/testing installation, not a signed Play Store release. After install, open Daymark while online, sign in, enable offline reminders in Settings, and allow OS notification and alarm permissions when prompted.

## Supabase and Google sign-in for the native app

Add `com.daymark.scheduler://auth-callback` to **Supabase → Authentication → URL Configuration → Redirect URLs**. Keep the existing HTTPS Vercel URL and localhost URLs. Google Cloud's **Authorized redirect URI** should remain the Supabase callback URL shown by the Google provider (normally `https://<project-ref>.supabase.co/auth/v1/callback`); the custom scheme is the Supabase post-auth return target, not Google's callback URL.

Native OAuth uses PKCE and the Capacitor Browser/App plugins. The native platform patch registers the custom scheme on Android/iOS.

## Build iOS

Requires a Mac with current Xcode and Apple's iOS toolchain. Run `npm install`, set the same two `VITE_...` variables, then `npm run cap:init:ios` once, `npm run cap:sync:ios`, and `npm run cap:open:ios`. Use Xcode to set signing/team and run on a device. TestFlight/App Store distribution requires appropriate Apple signing and distribution setup; this repository does not include signing certificates or provisioning profiles.

## Web deployment remains the same

Vercel still builds the regular website with `npm run build` into `dist`. Capacitor dependencies are platform-aware, and native notification code does not replace the browser/PWA reminder path. The mobile app bundle and web website are two clients of the same Supabase schedule.
