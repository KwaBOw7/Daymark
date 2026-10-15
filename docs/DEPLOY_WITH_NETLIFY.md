# Publish Daymark with Netlify (no GitHub required)

This route deploys the built static site from your computer. The same HTTPS URL can be opened on desktop and mobile; Supabase provides shared cloud persistence.

## 1. Use the project folder you already run locally

Keep your existing `.env.local`. It must contain only the Supabase Project URL and browser publishable/anon key:

```dotenv
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_PUBLISHABLE_KEY
```

Never place a service-role/secret key or database password in this file. Vite embeds VITE_ values in browser assets, so only public/publishable values belong here.

## 2. Build the site

From the project folder, run:

```bash
npm install
npm run build
```

The command should create a `dist` folder. If it reports errors, resolve them before deploying. Do not upload `.env.local` or `node_modules`.

## 3. Deploy without GitHub

1. Open https://app.netlify.com/drop and sign in/create an account.
2. In File Explorer/Finder, drag the **dist folder's contents** (or the `dist` folder if accepted by the UI) into the manual deploy area. Make sure you deploy the generated output, not the full source folder.
3. Wait for Netlify to assign an HTTPS URL such as `https://your-site-name.netlify.app`.
4. Open that URL and test Google/email sign-in and create a test event. In Site settings you can rename the generated site name if available.

When using manual deploy, rebuild and upload `dist` again for every code change. `.env.local` is used at build time; Netlify does not need it because the public Supabase values are embedded in the built app. Do not upload `.env.local`.

## 4. Allow production authentication redirects

In Supabase Dashboard → Authentication → URL Configuration:
- Set Site URL to the exact deployed HTTPS origin, for example `https://your-site-name.netlify.app`.
- Add `https://your-site-name.netlify.app/**` to Redirect URLs.
- Keep `http://localhost:5173/**` for development.

In Google Cloud → Google Auth Platform → Clients → your Web client, add the deployed origin under Authorized JavaScript origins if requested by the current client configuration. Keep the Supabase callback URL under Authorized redirect URIs exactly as displayed by Supabase; it is normally `https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback`.

## 5. Verify sync across devices

1. Sign in at the Netlify URL on your computer.
2. Create an event, wait for the app to say Synced, and refresh.
3. Open the same HTTPS URL on your phone, sign in with the same account, and verify the event appears.
4. Create a second test event on the phone and verify it appears on desktop.

A signed-in badge alone is not proof of sync. Both directions must succeed.

## Important

The Web Push function still needs server-side deployment/secrets and a scheduler for notifications while the app is closed. Publishing the PWA does not automatically configure background push delivery.
