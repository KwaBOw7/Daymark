DAYMARK NATIVE MOBILE PATCH

These files are relative to the root of your existing Daymark GitHub repository.
Copy/replace them at those exact paths. New files are:
- capacitor.config.ts
- .github/workflows/android-apk.yml
- scripts/patch-native-platforms.mjs
- src/domain/nativeReminders.ts
- src/services/nativeNotifications.ts
- docs/NATIVE_APP.md
- public/docs/NATIVE_APP.md

The patch uses npm install to reconcile package.json/package-lock.json on the build runner.
Do not upload .env.local, database passwords, OAuth client secrets, or Supabase secret/service-role keys.

After committing, create GitHub Actions repository Variables (not secrets) named:
- VITE_SUPABASE_URL
- VITE_SUPABASE_ANON_KEY

Then go to Actions > Build Android APK > Run workflow. Download the daymark-android-debug-apk artifact after success. This is a debug APK for device testing, not a signed store release.

For mobile Google/email OAuth, add com.daymark.scheduler://auth-callback to Supabase Authentication > URL Configuration > Redirect URLs. The Google OAuth authorized redirect remains the Supabase callback URL.
