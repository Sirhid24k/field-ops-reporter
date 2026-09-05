import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { completeJoin, PENDING_INVITE_COOKIE, PENDING_NAME_COOKIE } from "@/lib/invites";
import { homeFor } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";

/**
 * Where the invite magic link lands after /auth/callback: creates the profile
 * with the invite's org and role, marks the invite used, and routes by role.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const origin = request.nextUrl.origin;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL(`/join/${code}`, origin));

  const cookieStore = await cookies();
  const result = await completeJoin(user, code, cookieStore.get(PENDING_NAME_COOKIE)?.value ?? null);

  const response = NextResponse.redirect(
    new URL(result.ok ? homeFor(result.role) : `/join/${code}?error=${result.reason}`, origin),
  );
  response.cookies.delete(PENDING_INVITE_COOKIE);
  response.cookies.delete(PENDING_NAME_COOKIE);
  return response;
}
