# Daymark — setup and deployment

Daymark is a React + TypeScript + Vite PWA. It uses deterministic algorithms only; there is no AI API, LLM SDK or AI dependency. Without credentials, the schedule works in local-only mode using browser storage. Cloud sync and closed-app push are explicitly unavailable until you finish the steps below.

## 1. Run locally

Requirements: Node.js 22+, npm, and a browser with modern Intl/Notifications/Service Worker support.

```sh
cp .env.example .env.local
npm install
npm run dev
```

Open the Vite address printed in the terminal. If `.env.local` has no real Supabase URL and publishable/anon key, Daymark says `Local mode · this device only`; no fake cloud writes are made. Production build: `npm run build`; unit suite: `npm test`; types: `npm run typecheck`.

**Workspace note:** the authoring environment used to create this project had no repository mounted and could not reach `registry.npmjs.org` while dependencies were being installed. The source is provided as a full project, but dependency installation, browser verification, typecheck, tests and production build must be rerun in a network-enabled development environment before deployment. This is an explicit blocker, not a claim that unrun commands passed.

## 2. Supabase cloud sync and auth

1. Create a Supabase project.
2. In **Project Settings → API**, copy the project URL and publishable/anon key to `.env.local` as `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Never put a service-role key in a `VITE_*` variable.
3. Install the Supabase CLI and link the project, or paste `supabase/migrations/202610140001_initial_schema.sql` into the Supabase SQL Editor. The migration creates data tables, owner-only RLS policies, optimistic compare-and-swap RPCs and an event reminder queue.
4. In **Authentication → URL Configuration**, add the local Vite URL (for example `http://localhost:5173`) and your production HTTPS URL to Site URL / Redirect URLs as appropriate.
5. In **Authentication → Providers → Google**, enable Google, enter the Google OAuth Client ID and secret from Google Cloud Console, and use the Supabase **Callback URL** shown on that provider's configuration page as the Google OAuth redirect URI. Add the same client ID and secret to Supabase only (not the frontend bundle).
6. Enable Email OTP/magic-link sign-in in **Authentication → Providers → Email**. Ensure mail provider/rate limits suit your use. Users can sign in through Google or request an email magic link.
7. Deploy the rebuilt frontend after setting the production environment variables. On a static host, use SPA fallback to `/index.html`; host the manifest and service worker on the same HTTPS origin.

Cloud operations use the authenticated Supabase session and owner RLS. Per-row compare-and-swap RPCs reject stale updates instead of silently overwriting edits from another device. If offline, the app caches edits and queues sync attempts. When a compare-and-swap conflict occurs, the local copy is preserved; export/review before resolving the conflict rather than assuming a merge was made.

### When the app says it is not syncing

Use the banner's **Try again** / **Retry sync** action after the latest sync-diagnostics patch is installed. Network failures are labelled separately from Supabase API errors; the message includes the failing table or RPC and the PostgREST code/details.

- `PGRST205` / `42P01`: the API cannot find a required table. Confirm the migration was run against the same Supabase project URL configured in `.env.local`; then allow the schema cache a moment to refresh.
- `42501` / `permission denied`: review grants and RLS policies. Do not disable RLS as a workaround.
- `401` / JWT-related errors: sign out and sign in again, and verify the browser key belongs to this project.
- `concurrent_edit`: another client changed that row; export the recovery JSON before reconciling local queued edits.
- A `Failed to fetch` / network error: only this class indicates the browser could not complete the request; check the request to the Supabase project URL in browser DevTools.

Daymark does not discard pending writes on ordinary sync errors. Export a recovery copy before resolving a genuine version conflict.

## 3. PWA installation

Use HTTPS (or localhost during development). Open the browser's install menu / “Add to Home Screen”. The manifest, SVG app icon, shell cache and service worker are included. Installation prompts vary by browser/platform. Service workers do not provide offline push on every platform; iOS web push requires a supported iOS version and an installed Home Screen web app.

## 4. Notifications

### In-app and visible-page notifications

Open Settings → Notifications and choose **Enable pop-ups**. After permission is granted, the button becomes **Send test pop-up** so you can verify that the device displays an OS notification. While Daymark is open, reminder checks run every 15 seconds and also run when the page becomes visible/focused again; a five-minute catch-up window avoids dropping an alert when the browser temporarily throttles the tab. Fired reminders are deduplicated using per-account browser storage. A browser timer alone cannot wake the app after it is closed; Daymark does not claim that foreground pop-ups can do that.

### Real closed-app Web Push (requires configuration)

1. Generate a VAPID keypair using a trusted Web Push utility (for example `npx web-push generate-vapid-keys`) on a secure machine. Do not commit the private key.
2. Set the public key as `VITE_VAPID_PUBLIC_KEY` at frontend build time.
3. Set Supabase Edge Function secrets: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (for example a monitored `mailto:` contact), and a high-entropy `PUSH_CRON_SECRET`. The service-role key is injected by Supabase Edge Functions and must never be exposed in the browser.
4. Deploy the function: `supabase functions deploy dispatch-reminders --no-verify-jwt`. It uses the private function secret header as its authorization guard and the service role only on the server.
5. Configure a scheduled invocation **once per minute** using Supabase Cron/pg_cron and pg_net or an external scheduler. Store the function URL and `PUSH_CRON_SECRET` in Supabase Vault / the scheduler's secret store, not in SQL source control. Example when pg_cron, pg_net and Vault are enabled:

```sql
select cron.schedule(
  'daymark-dispatch-reminders', '* * * * *',
  $$select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'daymark_function_url'),
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-daymark-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name = 'daymark_push_cron_secret')
    ),
    body := '{}'::jsonb
  );$$
);
```

Create Vault secrets `daymark_function_url` (the full `https://PROJECT_REF.supabase.co/functions/v1/dispatch-reminders` URL) and `daymark_push_cron_secret`. Configure the same random secret as the function secret `PUSH_CRON_SECRET`. Check function logs and the `reminder_queue.last_error` column to diagnose delivery. The queue is produced by database triggers for persisted fixed events and recurring events over the next 60 days. A push subscription must be registered by a signed-in user on each desired browser/device. In Settings → Notifications, click **Enable Web Push** on each device, then use **Send test pop-up** to separately verify foreground display. Due rows are atomically claimed in PostgreSQL so concurrent Cron invocations do not normally send the same queued row together; failures retry up to five times and delivery follows at-least-once semantics (the notification tag helps collapse retries). Browser/OS battery, permission and vendor policies still affect delivery.

## 5. Data and privacy

- Local-only data is in browser localStorage. Clearing site data or changing browsers can erase this local-only copy; export a JSON file from Import plan before moving machines.
- Signed-in schedules use separate per-user tables protected by RLS. Push subscriptions and queue data are scoped to the authenticated user. Do not disable RLS.
- Back up Supabase regularly. The app deliberately does not auto-delete omitted import records.
- The scheduler doesn't move fixed or locked commitments. It produces suggestions; existing generated blocks are replaced only after explicit confirmation. A drag on an expanded recurring event creates an exception and a one-off override, leaving the remaining recurrence instances intact.

## 6. Known MVP limitations

- The domain test suite can run without installed frontend dependencies. The full Vite build, frontend typecheck and browser/deployment verification could not be completed in the authoring environment because npm registry DNS was unavailable.
- The allocator supports split study sessions when requested, distributing chunks across separate eligible days. It will explicitly report any incomplete session and advisory alternative slots.
- Push scheduling is implemented server-side for fixed event records and their recurrence. Tasks need generated session events before their reminders can be enqueued. A configured Cron is required; deploying the function alone does not deliver notifications in the background.
- Conflict resolution is explicit but currently guided by exporting/reloading; there is no automatic three-way merge editor.

## Native Android/iOS packaging

For the Capacitor wrapper and device-local reminders that can fire without data/Wi-Fi after being scheduled, follow [NATIVE_APP.md](NATIVE_APP.md). The native APK workflow requires GitHub Actions repository variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
