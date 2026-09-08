"use client";

import { useState, useTransition } from "react";
import { editReportField } from "@/app/(admin)/dashboard/reports/[id]/actions";
import { Button, Input, Select } from "@/components/ui";
import { type EditableField, FIELD_KINDS, FIELD_LABELS, type FieldValue, inputValue, TRIP_STATUS_VALUES } from "@/lib/admin/report-fields";
import { cn } from "@/lib/cn";
import { humanize } from "@/lib/format";

export type FieldPart = { field: EditableField; value: FieldValue };

export type FieldRowView = {
  key: string;
  label: string;
  /** What the row shows; null renders as "—". */
  display: string | null;
  /** The columns behind the value (two for Route and Load); empty when the row is read-only. */
  parts: FieldPart[];
  /** Numbers in condensed tabular digits; text stays in the body face. */
  numeric: boolean;
  flagged: boolean;
  edited: boolean;
  /** A short steel note under the value ("from last reading"). */
  note?: string | null;
};

export type FieldListProps = {
  reportId: string;
  rows: FieldRowView[];
  /** False once a report is approved or while it is still moving. */
  canEdit: boolean;
};

/**
 * "What the system understood": label over value, two columns (wireframe 1l). Every value
 * is click-to-edit; a save writes the promoted column and `extracted`, logs a report_edits
 * row and re-runs the checks; the row then carries the small "edited" tag.
 */
export function FieldList({ reportId, rows, canEdit }: FieldListProps) {
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-5">
      {rows.map((row) =>
        editing === row.key ? (
          <RowEditor key={row.key} reportId={reportId} row={row} onDone={() => setEditing(null)} />
        ) : (
          <div key={row.key} className="min-w-0">
            <dt className="text-caption text-steel">{row.label}</dt>
            <dd className="mt-0.5">
              <Value row={row} onEdit={canEdit && row.parts.length > 0 ? () => setEditing(row.key) : null} />
              {row.note ? <span className="block text-caption text-steel">{row.note}</span> : null}
            </dd>
          </div>
        ),
      )}
    </dl>
  );
}

function Value({ row, onEdit }: { row: FieldRowView; onEdit: (() => void) | null }) {
  const text = (
    <span className={cn(row.numeric && "font-display text-body-lg font-semibold tabular", row.flagged ? "text-flag" : row.display === null && "text-steel")}>
      {row.display ?? "—"}
      {row.flagged ? (
        <>
          <span aria-hidden="true"> !</span>
          <span className="sr-only">, failed a check</span>
        </>
      ) : null}
    </span>
  );
  const tag = row.edited ? (
    <span className="ml-2 inline-block rounded-control border border-line px-1.5 align-middle font-display text-caption font-semibold text-steel">edited</span>
  ) : null;

  if (!onEdit) {
    return (
      <span className={cn("inline-block break-words py-0.5", !row.numeric && "text-body-lg")}>
        {text}
        {tag}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onEdit}
      title="Edit"
      className={cn("-mx-1.5 inline-block max-w-full rounded-control px-1.5 py-0.5 text-left break-words hover:bg-ink/6", !row.numeric && "text-body-lg")}
    >
      {text}
      {tag}
      <span className="sr-only">, edit</span>
    </button>
  );
}

function RowEditor({ reportId, row, onDone }: { reportId: string; row: FieldRowView; onDone: () => void }) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(row.parts.map((part) => [part.field, inputValue(part.value)])));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    startTransition(async () => {
      for (const part of row.parts) {
        const typed = values[part.field] ?? "";
        if (typed.trim() === inputValue(part.value).trim()) continue;
        const result = await editReportField({ reportId, field: part.field, value: typed });
        if (!result.ok) {
          setError(result.message);
          return;
        }
      }
      onDone();
    });
  }

  return (
    <div className="col-span-2 rounded-control border border-line p-3">
      <p className="text-caption text-steel">{row.label}</p>
      <form
        className="mt-2 flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        {row.parts.map((part, index) => {
          const kind = FIELD_KINDS[part.field];
          const label = row.parts.length > 1 ? FIELD_LABELS[part.field] : undefined;
          if (kind === "trip_status") {
            return (
              <Select key={part.field} label={label} value={values[part.field] ?? ""} onChange={(event) => setValues({ ...values, [part.field]: event.target.value })} className="min-w-[12rem] flex-1" autoFocus={index === 0}>
                <option value="">Not given</option>
                {TRIP_STATUS_VALUES.map((status) => (
                  <option key={status} value={status}>
                    {humanize(status)}
                  </option>
                ))}
              </Select>
            );
          }
          return (
            <Input
              key={part.field}
              label={label}
              value={values[part.field] ?? ""}
              onChange={(event) => setValues({ ...values, [part.field]: event.target.value })}
              inputMode={kind === "text" ? "text" : "decimal"}
              autoComplete="off"
              autoFocus={index === 0}
              inputClassName={kind === "text" ? undefined : "font-display font-bold tabular"}
              className="min-w-[10rem] flex-1"
            />
          );
        })}
        <div className="flex gap-2">
          <Button type="submit" loading={pending} loadingLabel="Saving…">
            Save
          </Button>
          <Button type="button" variant="text" onClick={onDone} disabled={pending}>
            Cancel
          </Button>
        </div>
      </form>
      {error ? (
        <p role="alert" className="mt-2 text-caption text-flag">
          {error}
        </p>
      ) : null}
    </div>
  );
}
