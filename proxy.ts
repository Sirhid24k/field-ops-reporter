import type { NextRequest } from "next/server";
import { createProxyClient } from "@/lib/supabase/proxy";
import { PENDING_INVITE_COOKIE } from "@/lib/invites-shared";
import { homeFor } from "@/lib/roles";

/**
 * Session refresh plus routing by auth state:
 *   signed out                      → /signin (protected routes)
 *   signed in, no profile           → /onboarding, or the pending invite's completion
 *   signed in, role field           → /app
 *   signed in, admin or supervisor  → /dashboard
 * /join/* only gets the session refresh; the page handles every state itself.
 */
export async function proxy(request: NextRequest) {
  const { supabase, response, redirect } = createProxyClient(request);
  const { pathname, search } = request.nextUrl;

  const wantsApp = pathname === "/app" || pathname.startsWith("/app/");
  const wantsDashboard = pathname === "/dashboard" || pathname.startsWith("/dashboard/");
  const wantsOnboarding = pathname === "/onboarding" || pathname.startsWith("/onboarding/");
  const wantsJoin = pathname === "/join" || pathname.startsWith("/join/");
  const isSignin = pathname === "/signin";
  const isRoot = pathname === "/";

  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims.sub ?? null;

  if (wantsJoin) return response();

  if (!userId) {
    if (wantsApp || wantsDashboard || wantsOnboarding) {
      return redirect(`/signin?next=${encodeURIComponent(pathname + search)}`);
    }
    if (isRoot) return redirect("/signin");
    return response();
  }

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", userId).maybeSingle();

  if (!profile) {
    if (wantsOnboarding) return response();
    const pendingInvite = request.cookies.get(PENDING_INVITE_COOKIE)?.value;
    if (pendingInvite && /^[A-Za-z0-9_-]{6,64}$/.test(pendingInvite)) {
      return redirect(`/join/${pendingInvite}/complete`);
    }
    return redirect("/onboarding");
  }

  const home = homeFor(profile.role);
  if (isSignin || isRoot) return redirect(home);
  if (wantsApp && profile.role !== "field") return redirect(home);
  if ((wantsDashboard || wantsOnboarding) && profile.role === "field") return redirect(home);

  return response();
}

export const config = {
  matcher: ["/", "/signin", "/app/:path*", "/dashboard/:path*", "/onboarding/:path*", "/join/:path*"],
};
