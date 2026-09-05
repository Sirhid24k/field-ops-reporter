import type { ZodError } from "zod";

/** Shared shape for useActionState-driven forms. `undefined` means nothing to show yet. */
export type FormState =
  | {
      error?: string;
      fieldErrors?: Record<string, string>;
      /** What was submitted, so the form can keep it after an error (React resets forms after an action). */
      values?: Record<string, string>;
    }
  | undefined;

/** First message per field from a zod error, keyed by the top-level field name. */
export function fieldErrorsFrom(error: ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}

/** FormData value as a trimmed string ("" when absent). */
export function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}
