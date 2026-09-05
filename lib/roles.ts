import type { Enums } from "@/lib/supabase/types";

export type UserRole = Enums<"user_role">;

/** Where a role lands after sign-in. */
export function homeFor(role: UserRole): string {
  return role === "field" ? "/app" : "/dashboard";
}

export function isStaff(role: UserRole): boolean {
  return role === "admin" || role === "supervisor";
}

/** Plain-language role, as shown to people ("added you as a driver"). */
export function roleLabel(role: UserRole): string {
  return role === "field" ? "driver" : role;
}
