import { asObject, incidentsFrom } from "@/lib/admin/report-fields";
import { daysBetween, type PipelineDb, toJson } from "./db";
import { INCIDENT_TYPES, SEVERITIES } from "./extract";
import { logPipeline } from "./log";
import { replaceAlerts } from "./process";
import { type Incident, type IncidentType, type Severity, type ValidationInput, type ValidationResult, validateReport } from "./validate";

/**
 * Re-runs the deterministic checks on a report's current promoted columns, after a
 * supervisor fixes a field on the dashboard. Same rules, same reference data and the same
 * alert replacement as the pipeline's validate step; the report keeps its status and
 * nothing is sent to a model. Runs through whatever client it is given: the dashboard passes
 * the supervisor's own session, so RLS scopes the reads and writes to their organisation.
 */
export async function recheckReport(db: PipelineDb, reportId: string): Promise<ValidationResult[]> {
  const { data: report, error } = await db
    .from("reports")
    .select(
      "id, org_id, vehicle_id, report_date, odometer_start, odometer_end, fuel_liters, fuel_cost_ngn, load_tonnage, extracted, vehicles(current_odometer), organizations(fuel_baseline_km_per_l)",
    )
    .eq("id", reportId)
    .maybeSingle();
  if (error) throw new Error(`Could not load report ${reportId}: ${error.message}`);
  if (!report) throw new Error(`Report ${reportId} was not found.`);

  const [duplicates, lastReviewed] = await Promise.all([
    db
      .from("reports")
      .select("id")
      .eq("vehicle_id", report.vehicle_id)
      .eq("report_date", report.report_date)
      .neq("id", report.id)
      .in("status", ["ready", "reviewed"]),
    db
      .from("reports")
      .select("report_date")
      .eq("vehicle_id", report.vehicle_id)
      .eq("status", "reviewed")
      .neq("id", report.id)
      .order("report_date", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (duplicates.error) throw new Error(`Could not check duplicates for ${report.id}: ${duplicates.error.message}`);
  if (lastReviewed.error) throw new Error(`Could not read vehicle history for ${report.id}: ${lastReviewed.error.message}`);

  const extracted = asObject(report.extracted);
  const lastOdometer = report.vehicles?.current_odometer ?? null;
  // The pipeline fills a missing start from the last approved reading (docs/session-3-notes.md);
  // for the checks that reading is still "not given", so the messages keep saying so.
  const startWasFilledIn =
    extracted?.odometer_start === null && report.odometer_start !== null && report.odometer_start === lastOdometer;

  const incidents: Incident[] = incidentsFrom(extracted).map((incident) => ({
    type: (INCIDENT_TYPES as readonly string[]).includes(incident.type) ? (incident.type as IncidentType) : "other",
    severity: (SEVERITIES as readonly string[]).includes(incident.severity) ? (incident.severity as Severity) : "low",
    description: incident.description,
  }));

  const input: ValidationInput = {
    odometerStart: startWasFilledIn ? null : report.odometer_start,
    odometerEnd: report.odometer_end,
    fuelLiters: report.fuel_liters,
    fuelCostNgn: report.fuel_cost_ngn,
    loadTonnage: report.load_tonnage,
    incidents,
    lastOdometer,
    daysSinceLastOdometer: daysBetween(lastReviewed.data?.report_date ?? null, report.report_date),
    fuelBaselineKmPerL: report.organizations?.fuel_baseline_km_per_l ?? null,
    hasDuplicate: (duplicates.data?.length ?? 0) > 0,
  };
  const verdict = validateReport(input);

  const { error: saveError } = await db.from("reports").update({ validation: toJson(verdict.results) }).eq("id", report.id);
  if (saveError) throw new Error(`Could not save the checks for ${report.id}: ${saveError.message}`);
  const alerts = await replaceAlerts(db, report, verdict.alerts);

  logPipeline({
    step: "recheck",
    reportId: report.id,
    outcome: "ok",
    failedRules: verdict.results.filter((result) => !result.passed).map((result) => result.rule),
    alerts,
  });
  return verdict.results;
}
