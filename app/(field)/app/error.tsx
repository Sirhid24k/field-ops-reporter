"use client";

import { useEffect } from "react";
import { BackHeader, BottomZone, Screen } from "@/components/field/Frame";
import { Button } from "@/components/ui";

/** A driver screen that failed to load: the shell (offline banner, queue) stays; one action, the thumb's. */
export default function FieldErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <Screen>
      <BackHeader title="Something went wrong" />
      <p className="mt-3 text-body-lg">This screen couldn&rsquo;t load. Your reports are safe, on this phone and at the office.</p>
      <p className="mt-2 text-body text-steel">Try again. If it keeps happening, close the app and open it again.</p>
      <BottomZone>
        <Button size="field" block onClick={reset}>
          Try again
        </Button>
      </BottomZone>
    </Screen>
  );
}
