# Daymark — Personal Scheduler

A responsive React + TypeScript + Vite Progressive Web App for your timetable, personal study, flexible tasks, reminders, and versioned JSON plan imports. Scheduling uses deterministic rules; there are **no AI services or AI dependencies**.

## Start here

1. Install Node.js 22 or newer (required by the native Capacitor toolchain).
2. Copy `.env.example` to `.env.local` (you can leave the values blank for local-only mode).
3. Run `npm install`, then `npm run dev`.
4. Use **Import plan → Sample JSON** to preview a schedule format, or create your first event from the planner. No example items are preloaded into personal data.

The static sample is also [available here](public/sample-schedule.json). The format is documented in [the import specification](docs/IMPORT_FORMAT.md), and cloud/auth/push deployment steps are in [the setup guide](docs/SETUP.md).

## Commands

- `npm run dev` — local development server
- `npm test` — dependency-light domain test suite
- `npm run typecheck` — full TypeScript check (requires dependencies)
- `npm run build` — typecheck and production Vite build
- `npm run preview` — preview a production build

## Storage modes

Without Supabase credentials, events/tasks/settings remain in this browser's local storage; they do not sync to another device. Supabase Auth, PostgreSQL owner-RLS and compare-and-swap writes are provided when configured. Closed-app Web Push requires a VAPID keypair, a deployed Supabase Edge Function, and a configured once-per-minute scheduler. Detailed requirements are in the setup guide.

## Verification status (authoring workspace, 2026-10-16)

- `npm run test:core`: **33 passed, 0 failed** in the authoring workspace.
- TypeScript/TSX syntax transpilation: zero syntax diagnostics for the updated app, native notification service, scheduler, Supabase config, and Capacitor config.
- Android/iOS native packaging source and GitHub Actions APK workflow are included, but the native APK/IPA has not been built in this restricted workspace.
- Network access to `registry.npmjs.org` failed with DNS `EAI_AGAIN`, so the full dependency-backed typecheck, Vite production build, and native Gradle build could not be completed here. The GitHub Actions runner is configured to install dependencies and build an Android debug APK after the required repository variables are added.
- These authoring-workspace limitations do not reflect tests you have already performed on your deployed web app. The new native build and offline notification path still require device testing.

Run the provided CI workflow on a network-enabled runner and resolve any errors before treating a native package as verified. See [the setup guide](docs/SETUP.md).

## Deployment configs

- `vercel.json` configures a Vite build and SPA fallback for Vercel.
- `netlify.toml` configures a Vite build and SPA fallback for Netlify.
- `.github/workflows/ci.yml` runs the domain tests, TypeScript check and production build on pushes and pull requests. The checks must pass in a network-enabled CI runner before calling a deployment verified.

For cloud sync, set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (publishable/anon client key only) in the hosting provider's build environment and in local `.env.local`. Apply the SQL migration to the *same* Supabase project. Never use a service-role key in a browser-facing `VITE_` variable.

## Publish without GitHub

See [docs/DEPLOY_WITH_NETLIFY.md](docs/DEPLOY_WITH_NETLIFY.md) for the manual build-and-deploy flow using Netlify Drop.

## Native mobile app

See [docs/NATIVE_APP.md](docs/NATIVE_APP.md) for the Capacitor Android/iOS wrapper, APK build workflow, native OAuth callback configuration, and offline local-notification behavior.
