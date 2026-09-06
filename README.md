# Field Ops Reporter

Voice-first daily reporting for small haulage and site-work firms. Drivers send a voice note from a
low-bandwidth PWA; the server transcribes it, extracts a structured report, checks the numbers, asks
back when something is missing, and posts it to a supervisor dashboard.

Next.js (App Router, TypeScript, Tailwind v4) on Supabase (Postgres + RLS, Auth, Storage).

## Setup

```bash
npm install
cp .env.example .env.local   # then fill it in
npm run db:push              # applies supabase/migrations to your project
npm run dev
```

`.env.local` needs, at minimum for this stage: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY` (server-only), `SUPABASE_DB_URL` (session-pooler connection string, used by the
db scripts) and `NEXT_PUBLIC_APP_URL`.

In the Supabase dashboard, add `http://localhost:3000/**` (and your deployed origin) under
Authentication → URL configuration → Redirect URLs so magic links come back to the app.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server on http://localhost:3000 |
| `npm run build` / `npm start` | Production build / serve |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run db:push` | Apply migrations to the database in `SUPABASE_DB_URL` |
| `npm run db:types` | Regenerate `lib/supabase/types.ts` (needs Docker) |
| `npm run icons` | Regenerate the PWA icons in `public/icons` and `app/apple-icon.png` |
| `npm run dev:magic-link -- <email> [next]` | Print a sign-in link without sending an email |
| `npm run rls:proof -- <admin-email> <field-email>` | Prove the RLS policies with real user JWTs |

## Where things are

- `app/` — routes. `(field)/app` is the driver PWA (Today, `new`, `clarify/[reportId]`, `reports`),
  `(admin)/dashboard` is the supervisor dashboard, `onboarding`, `join/[code]`, `signin`, `auth/callback`,
  `api/ping` (connectivity probe). `dev/ui` is the primitive gallery; `dev/report-status` flips a report's
  status for testing (off in production unless `DEV_TOOLS=true`). `manifest.ts` is the web app manifest.
- `components/ui/` — the design-system primitives (Button, StatusChip, OdometerDigits, Input, Select,
  Textarea, ProgressLine, Sheet, Drawer). `components/field/` — the driver screens' parts (record control,
  Today card, forms, the offline shell).
- `lib/recorder.ts` (MediaRecorder), `lib/queue.ts` (IndexedDB offline queue), `lib/report-status.ts`
  (status → chip/card mapping), `lib/dates.ts` (org-timezone formatting).
- `public/sw.js` — the service worker; it only caches the app shell. Registered in production builds
  (`next build && next start`), or in dev with `NEXT_PUBLIC_ENABLE_SW=1`.
- `lib/supabase/` — server, browser, proxy and admin (service role, server-only) clients plus types.
- `supabase/migrations/` — schema, RLS, storage.
- `proxy.ts` — session refresh and routing by auth state.
- `docs/` — spec, design brief, per-session notes.
