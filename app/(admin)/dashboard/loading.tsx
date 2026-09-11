import { RouteLoading } from "@/components/RouteLoading";

/** Shown inside the admin shell's content column while a dashboard page streams in; the rail stays put. */
export default function DashboardLoading() {
  return <RouteLoading className="min-h-[60dvh]" />;
}
