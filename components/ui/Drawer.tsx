"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Button } from "./Button";

export type DrawerProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  className?: string;
};

/**
 * Right-hand drawer for the admin surface (vehicle and invite forms). Square
 * corners like every other section; a text "Close" control in the header so
 * nothing is icon-only.
 */
export function Drawer({ open, onClose, title, children, className }: DrawerProps) {
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
      aria-labelledby={titleId}
      className={cn(
        "fixed inset-0 m-0 ml-auto h-full max-h-full w-full max-w-[420px]",
        "overflow-y-auto rounded-none border-l border-line bg-paper p-0 text-ink",
        "backdrop:bg-ink/40 open:animate-drawer-in",
        className,
      )}
    >
      <div className="flex min-h-full flex-col">
        <header className="flex items-center justify-between gap-4 border-b border-line px-6 py-4">
          <h2 id={titleId} className="font-display text-heading font-bold">
            {title}
          </h2>
          <Button variant="text" onClick={onClose}>
            Close
          </Button>
        </header>
        <div className="flex-1 px-6 py-6">{children}</div>
      </div>
    </dialog>
  );
}
