import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { homeFor } from "@/lib/roles";

/** proxy.ts normally routes "/" before it renders; this is the fallback. */
export default async function RootPage() {
  const { user, profile } = await getSession();
  if (!user) redirect("/signin");
  if (!profile) redirect("/onboarding");
  redirect(homeFor(profile.role));
}
