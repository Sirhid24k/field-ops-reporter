// Prints a sign-in code and link for local testing without sending an email.
//   npm run dev:magic-link -- <email> [next-path] [--name "Full Name"]
// Uses the service role (server-side only). The user is created if it does not exist;
// --name is stored as user metadata (full_name), the same way the invite form does it.
// The code goes into the code step of /signin or /join/[code]; the link is the
// token-hash callback (same as a custom email template), which works in any browser.
// Both come from one generateLink call, so using one invalidates the other.
import { createClient } from "@supabase/supabase-js";
import nextEnv from "@next/env"; // CommonJS package: default import, then destructure

nextEnv.loadEnvConfig(process.cwd(), true);

const args = process.argv.slice(2);
const nameIndex = args.indexOf("--name");
const fullName = nameIndex >= 0 ? args[nameIndex + 1] : undefined;
const positional = nameIndex >= 0 ? [...args.slice(0, nameIndex), ...args.slice(nameIndex + 2)] : args;
const [email, next = "/"] = positional;
if (!email) {
  console.error('usage: npm run dev:magic-link -- <email> [next-path] [--name "Full Name"]');
  process.exit(2);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
if (!url || !serviceRoleKey) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local");
  process.exit(1);
}

const admin = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

const { data, error } = await admin.auth.admin.generateLink({
  type: "magiclink",
  email,
  options: fullName ? { data: { full_name: fullName } } : undefined,
});
if (error || !data.properties) {
  console.error(error?.message ?? "No link returned");
  process.exit(1);
}

const { hashed_token, verification_type, email_otp } = data.properties;
console.log(`code: ${email_otp}`);
console.log(`${appUrl}/auth/callback?token_hash=${hashed_token}&type=${verification_type}&next=${encodeURIComponent(next)}`);
