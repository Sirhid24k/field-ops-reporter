/**
 * One JSON line per pipeline event, so a stuck report during the demo run-through can be
 * traced with a grep for its id: `{"src":"pipeline","reportId":…,"step":…,"ms":…}`.
 */
export type PipelineLogEvent = {
  step: string;
  reportId?: string;
  outcome?: string;
  ms?: number;
} & Record<string, unknown>;

export function logPipeline(event: PipelineLogEvent): void {
  console.log(JSON.stringify({ at: new Date().toISOString(), src: "pipeline", ...event }));
}

/** `const elapsed = timer(); … elapsed()` → milliseconds since the call. */
export function timer(): () => number {
  const started = performance.now();
  return () => Math.round(performance.now() - started);
}
