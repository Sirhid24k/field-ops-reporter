"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStaff } from "@/lib/auth";
import { cutoffMinutes, generateDigest, localClock, type DigestStats } from "@/lib/pipeline/digest";
import { errorMessage, RetryableError } from "@/lib/pipeline/errors";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * On-demand digest generation (M18 "Regenerate" / "Generate now"): the same lib the cron
 * uses. Staff only; the org is the caller's. The digest page's buttons call it.
 */

export type GenerateDigestResult =
  | { ok: true; date: string; stats: DigestStats; content_md: string; source: "model" | "fallback" }
  | { ok: false; message: string };

const inputSchema = z.object({
  /** YYYY-MM-DD in the organisation's timezone; defaults to today. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export async function generateDigestNow(rawInput: unknown = {}): Promise<GenerateDigestResult> {
  const parsed = inputSchema.safeParse(rawInput ?? {});
  if (!parsed.success) return { ok: false, message: "That date isn't valid." };

  const { organization } = await requireStaff();
  const clock = localClock(organization.timezone, new Date());
  const date = parsed.data.date ?? clock.date;
  if (date > clock.date) return { ok: false, message: "That day hasn't happened yet." };

  // missing-report alerts only once the day is over or the cutoff has passed
  const pastCutoff = date < clock.date || clock.minutes >= cutoffMinutes(organization.report_cutoff_time);

  try {
    const result = await generateDigest(createAdminClient(), organization, date, { withMissingAlerts: pastCutoff });
    revalidatePath("/dashboard", "layout");
    return { ok: true, date, stats: result.data.stats, content_md: result.content_md, source: result.source };
  } catch (error) {
    if (error instanceof RetryableError) return { ok: false, message: "The writing model is busy. Try again in a minute." };
    return { ok: false, message: `The digest couldn't be generated: ${errorMessage(error)}` };
  }
}
