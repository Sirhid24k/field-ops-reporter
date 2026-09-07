import type { Enums, TablesUpdate } from "@/lib/supabase/types";
import type { PipelineDb } from "./db";

export type ReportStatus = Enums<"report_status">;

/**
 * Atomic compare-and-set on `reports.status`:
 * `update … where id = ? and status = ?`, returning the row. Exactly one caller wins a
 * transition, so two concurrent /api/process calls (or a sweep racing a worker) never
 * double-process a report. The `reports_status_changed_at` trigger stamps the change.
 */
export async function moveReportStatus(
  db: PipelineDb,
  reportId: string,
  from: ReportStatus | readonly ReportStatus[],
  to: ReportStatus,
  patch: Omit<TablesUpdate<"reports">, "status"> = {},
): Promise<boolean> {
  const update = db.from("reports").update({ ...patch, status: to }).eq("id", reportId);
  const filtered = typeof from === "string" ? update.eq("status", from) : update.in("status", [...from]);
  const { data, error } = await filtered.select("id");
  if (error) throw new Error(`Could not move report ${reportId} to ${to}: ${error.message}`);
  return (data?.length ?? 0) === 1;
}
