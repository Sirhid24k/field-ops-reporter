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

`.env.local` needs: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
(server-only), `SUPABASE_DB_URL` (session-pooler connection string, used by the db scripts), `NEXT_PUBLIC_APP_URL`,
and for the pipeline: `GEMINI_API_KEY` with `EXTRACTION_MODEL` / `DIGEST_MODEL` (both `gemini-3.5-flash` by
default), `STT_PROVIDER=groq` with `STT_API_KEY` (a Groq key; `STT_MODEL` defaults to `whisper-large-v3`), and
`CRON_SECRET` (any long random string; it guards `/api/process` and `/api/cron/*`). `.env.example` documents the
optional ones (`PIPELINE_BASE_URL`, `VERCEL_AUTOMATION_BYPASS_SECRET`).

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
| `npm run test` | Vitest unit tests (the validation rules) |
| `npm run pipeline:test -- <audio-file>` | Upload a clip as a report for the demo driver and run the pipeline inline, printing transcript, fields, checks, questions and alerts. Also `--text "…"`, `--report <id> --answer "…"`, `--answer-audio <file>`, `--cleanup` |
| `npm run digest:test -- [YYYY-MM-DD]` | Generate the daily digest for the demo org inline and cross-check its totals against the rows |

## Where things are

- `app/` — routes. `(field)/app` is the driver PWA (Today, `new`, `clarify/[reportId]`, `reports`),
  `(admin)/dashboard` is the supervisor dashboard, `onboarding`, `join/[code]`, `signin`, `auth/callback`,
  `api/ping` (connectivity probe), `api/process` (the pipeline worker, internal), `api/cron/sweep` and
  `api/cron/digest` (Vercel crons, see `vercel.json`). `dev/ui` is the primitive gallery; `dev/report-status`
  flips a report's status or runs the pipeline on it (off in production unless `DEV_TOOLS=true`).
  `manifest.ts` is the web app manifest.
- `lib/pipeline/` — the processing pipeline: `process.ts` (state machine, compare-and-set on status),
  `stt.ts` (Groq Whisper adapter + language labels), `extract.ts` (Gemini structured output, spec §6),
  `validate.ts` (the deterministic rules and every threshold; `validate.test.ts`), `clarify.ts` (one round of
  driver questions), `digest.ts` (stats from the rows, markdown from the model), `sweep.ts` (stuck-report
  re-queue with bounded retries), `internal.ts` (CRON_SECRET guard and the fire-and-forget trigger).
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
