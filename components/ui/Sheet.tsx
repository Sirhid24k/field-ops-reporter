"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export type SheetProps = {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  className?: string;
};

/**
 * Bottom sheet for the field PWA (10px top radius). Built on the native dialog
 * element so focus trapping, Escape and the backdrop come from the browser.
 * It slides up in response to the user; nothing animates on page load.
 */
export function Sheet({ open, onClose, title, children, className }: SheetProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onKeyDown={(event) => {
        // browsers close a modal dialog on Escape themselves; this keeps it explicit
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      aria-labelledby={title ? titleId : undefined}
      className={cn(
        "fixed inset-0 m-0 mt-auto w-full max-w-full sm:mx-auto sm:max-w-[480px]",
        "max-h-[85dvh] overflow-y-auto rounded-t-sheet border-t border-line bg-paper p-0 text-ink",
        "backdrop:bg-ink/40 open:animate-sheet-in",
        className,
      )}
    >
      <div className="px-4 pt-5 pb-8">
        {title ? (
          <h2 id={titleId} className="mb-3 font-display text-heading font-bold">
            {title}
          </h2>
        ) : null}
        {children}
      </div>
    </dialog>
  );
}
