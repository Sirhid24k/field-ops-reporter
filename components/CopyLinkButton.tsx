"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui";

/** "Copy link" → "Copied" (same verb, per the copy rules), then back after a moment. */
export function CopyLinkButton({ link }: { link: string }) {
  const [label, setLabel] = useState("Copy link");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setLabel("Copied");
    } catch {
      setLabel("Select the link and copy it");
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setLabel("Copy link"), 2500);
  }

  return (
    <Button variant="secondary" block onClick={copy}>
      {label}
    </Button>
  );
}
