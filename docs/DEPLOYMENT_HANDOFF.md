# Deployment handoff — Daymark

## What is prepared

- Vercel (`vercel.json`) and Netlify (`netlify.toml`) SPA deployment settings.
- GitHub Actions CI (`.github/workflows/ci.yml`) to install dependencies, run the 22-case core suite, check TypeScript and build the production bundle.
- Supabase schema and owner-scoped RLS in `supabase/migrations/202610140001_initial_schema.sql`.
- Google OAuth and email magic-link code paths, subject to Supabase dashboard setup.
- Server-side Web Push function and schedule instructions in `docs/SETUP.md`.

## External actions still required

1. Create a Supabase project under the project owner's account.
2. Apply the SQL migration to that project.
3. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` / publishable key in the local `.env.local` and the hosting provider's build environment. The browser key is intended to be public; **never** use a service-role key as a `VITE_` variable.
4. Enable email OTP/magic links. Configure Google OAuth only if desired, using the Supabase callback URL and Google's OAuth client credentials.
5. Push this directory to a Git repository and connect that repository to Vercel or Netlify, or deploy through the corresponding CLI logged into the owner's hosting account.
6. After deployment, add the final HTTPS origin to Supabase Auth redirect URLs and test the same account from two different devices: create/edit an event on device A, then confirm it appears on device B and survives refresh.
7. For closed-app push, configure VAPID secrets, deploy the `dispatch-reminders` Edge Function, register subscriptions from each device, and configure a once-per-minute secure scheduled invocation as documented.

## Verification from this workspace (2026-10-15)

- `npm run test:core`: 22 passed, 0 failed.
- Transpile-only syntax check: 16 TS/TSX/config files, 0 syntax diagnostics.
- Manifest, sample import, and deployment-config assertions passed.
- `npm ci` did not finish because the npm registry hostname failed DNS lookup (`EAI_AGAIN`). The full TypeScript check, Vite production build, and real-browser tests therefore remain unverified here.
- No Supabase, Vercel, Netlify, or GitHub credentials/configuration were present in the workspace. No public deployment or live cloud sync has been created by these steps.
