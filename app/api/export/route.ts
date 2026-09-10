import type { NextRequest } from "next/server";
import { chipLabel } from "@/components/ui";
import { incidentsFrom, asObject } from "@/lib/admin/report-fields";
import { getSession } from "@/lib/auth";
import { CSV_BOM, csvLine, EXPORT_COLUMNS } from "@/lib/csv";
import { dateInZone, isIsoDate } from "@/lib/dates";
import { chipForStatus } from "@/lib/report-status";
import { isStaff } from "@/lib/roles";

/**
 * GET /api/export?from=YYYY-MM-DD&to=YYYY-MM-DD (M19): the organisation's ready and
 * approved reports as CSV, streamed page by page as the signed-in supervisor (RLS scopes the
 * rows). UTF-8 BOM and CRLF so Excel opens it with the right characters and columns.
 */

export const dynamic = "force-dynamic";

const COLUMNS = [...EXPORT_COLUMNS];

const PAGE = 500;

export async function GET(request: NextRequest) {
  const { supabase, user, profile, organization } = await getSession();
  if (!user || !profile || !organization || !isStaff(profile.role)) {
    return new Response("Sign in as a supervisor to export reports.", { status: 401, headers: { "content-type": "text/plain; charset=utf-8" } });
  }

  const today = dateInZone(new Date(), organization.timezone);
  const params = request.nextUrl.searchParams;
  let from = isIsoDate(params.get("from")) ? params.get("from")! : today;
  let to = isIsoDate(params.get("to")) ? params.get("to")! : from;
  if (from > to) [from, to] = [to, from];

  const orgId = organization.id;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode(CSV_BOM + csvLine(COLUMNS)));
      let offset = 0;
      try {
        for (;;) {
          const { data, error } = await supabase
            .from("reports")
            .select(
              "report_date, status, origin, destination, odometer_start, odometer_end, distance_km, fuel_liters, fuel_cost_ngn, load_type, load_tonnage, extracted, vehicles(plate_number), profiles!reports_user_id_fkey(full_name), reviewer:profiles!reports_reviewed_by_fkey(full_name)",
            )
            .eq("org_id", orgId)
            .in("status", ["ready", "reviewed"])
            .gte("report_date", from)
            .lte("report_date", to)
            .order("report_date")
            .order("submitted_at")
            .range(offset, offset + PAGE - 1);
          if (error) throw new Error(error.message);

          for (const report of data ?? []) {
            const chip = chipForStatus(report.status);
            controller.enqueue(
              encoder.encode(
                csvLine([
                  report.report_date,
                  report.vehicles?.plate_number ?? null,
                  report.profiles?.full_name ?? null,
                  chip ? chipLabel(chip, "admin") : report.status,
                  report.origin,
                  report.destination,
                  report.odometer_start,
                  report.odometer_end,
                  report.distance_km,
                  report.fuel_liters,
                  report.fuel_cost_ngn,
                  report.load_type,
                  report.load_tonnage,
                  incidentsFrom(asObject(report.extracted)).length,
                  report.status === "reviewed" ? (report.reviewer?.full_name ?? null) : null,
                ]),
              ),
            );
          }
          if (!data || data.length < PAGE) break;
          offset += PAGE;
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });

  const filename = from === to ? `reports-${from}.csv` : `reports-${from}-to-${to}.csv`;
  return new Response(stream, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}
