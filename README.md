# Daymark — Personal Scheduler

A responsive React + TypeScript + Vite Progressive Web App for your timetable, personal study, flexible tasks, reminders, and versioned JSON plan imports. Scheduling uses deterministic rules; there are **no AI services or AI dependencies**.

## Start here

1. Install Node.js 20 or newer.
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

## Verification status (authoring workspace, 2026-10-15)

- `npm run test:core`: **22 passed, 0 failed**.
- TypeScript transpilation: **16 TS/TSX/config files**, zero syntax diagnostics.
- The PWA manifest, sample schedule JSON, Vercel JSON, Netlify config and CI workflow checks passed.
- `npm ci` could not complete because requests to `registry.npmjs.org` failed with DNS `EAI_AGAIN`. As a result, the full dependency-backed typecheck, Vite production build, and browser render could not be run in this workspace.
- No Supabase or hosting credentials are configured here. Live authentication, cross-device cloud sync, deployment, and closed-app Web Push have **not** been verified or activated.

Run the provided CI workflow on a network-enabled runner, fix any failures, configure Supabase, and deploy before treating this as a production-ready service. See [the setup guide](docs/SETUP.md).

## Deployment configs

- `vercel.json` configures a Vite build and SPA fallback for Vercel.
- `netlify.toml` configures a Vite build and SPA fallback for Netlify.
- `.github/workflows/ci.yml` runs the domain tests, TypeScript check and production build on pushes and pull requests. The checks must pass in a network-enabled CI runner before calling a deployment verified.

For cloud sync, set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (publishable/anon client key only) in the hosting provider's build environment and in local `.env.local`. Apply the SQL migration to the *same* Supabase project. Never use a service-role key in a browser-facing `VITE_` variable.

## Publish without GitHub

See [docs/DEPLOY_WITH_NETLIFY.md](docs/DEPLOY_WITH_NETLIFY.md) for the manual build-and-deploy flow using Netlify Drop.
