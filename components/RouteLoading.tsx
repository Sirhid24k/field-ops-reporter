import { Lettermark, ProgressLine } from "@/components/ui";
import { cn } from "@/lib/cn";

/**
 * The route-transition fallback for both shells (their loading.tsx files): the thin top line
 * at once, and the lettermark centred in the content area, pulsing slowly. The mark starts
 * invisible and the pulse begins after 150 ms (globals.css), so a fast navigation never
 * flashes it; under prefers-reduced-motion it is static at full opacity. The shell around it
 * (rail or top bar, offline banner) stays put; only the content area swaps.
 */
export function RouteLoading({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center justify-center", className)}>
      <ProgressLine active label="Loading page" />
      <Lettermark size={48} className="text-ink opacity-0 animate-mark-pulse motion-reduce:opacity-100" />
    </div>
  );
}
