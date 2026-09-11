import { Screen } from "@/components/field/Frame";
import { RouteLoading } from "@/components/RouteLoading";

/** Shown inside the driver shell while Today, New report, My reports or a detail streams in. */
export default function FieldLoading() {
  return (
    <Screen>
      <RouteLoading className="flex-1" />
    </Screen>
  );
}
