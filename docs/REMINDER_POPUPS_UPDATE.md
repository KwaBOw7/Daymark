# Daymark reminder pop-ups update

This update improves **foreground** notification delivery and settings diagnostics.

## Changes
- Uses `ServiceWorkerRegistration.showNotification()` when a service worker is available, with a page Notification fallback.
- Adds a Settings action to enable notification permission and then send a test pop-up.
- Explains the blocked-permission case and how to unblock the site from browser controls.
- Checks reminders every 15 seconds and immediately on focus, page show, and visibility restoration.
- Catches up a reminder for up to five minutes after its planned fire time and recalculates the message to avoid stale timing copy.
- Claims reminder keys in local storage before showing alerts to reduce duplicate pop-ups across tabs.
- Reuses an existing Web Push subscription rather than always creating a new one.

## Files changed
- `src/App.tsx`
- `src/domain/reminders.ts`
- `src/services/notifications.ts` (new)
- `src/styles.css`
- `tests/core.test.cjs`
- `docs/SETUP.md`
- `public/docs/SETUP.md`

## Apply the update to the GitHub repository
Upload the changed files to the matching paths in your existing repository and commit the changes. For the new file, navigate to `src/services` and add `notifications.ts`. Vercel should rebuild automatically after the commit. Keep `.env.local` and all private keys out of GitHub.

## Test after deployment
1. Open the deployed Daymark site, sign in, and navigate to Settings.
2. In Reminders, click `Enable pop-ups`. Allow notifications in the browser prompt.
3. The button should change to `Send test pop-up`; click it and check the OS notification tray/banner.
4. Add a temporary event a few minutes in the future with reminder offsets `1, 0`. Keep Daymark open and confirm a pop-up arrives before and at the start, then delete the test event.
5. Confirm the account/category reminder settings are enabled.

## Important limitation
This update does **not** by itself enable delivery while Daymark is completely closed. Closed-app Web Push requires the VAPID public key in Vercel, VAPID private/public keys and `PUSH_CRON_SECRET` in Supabase Edge Function secrets, the `dispatch-reminders` function deployed, and a once-per-minute secure scheduled invocation. Follow `docs/SETUP.md` section 4 for that server setup. Do not put the VAPID private key, `PUSH_CRON_SECRET`, database password, or Supabase service-role key in frontend environment variables or GitHub.
