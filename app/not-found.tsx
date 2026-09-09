import type { Metadata } from "next";
import Link from "next/link";
import { buttonClassName } from "@/components/ui";

export const metadata: Metadata = { title: "Page not found" };

/** The root 404: a mistyped address, an old link, or something that was removed. */
export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-[480px] flex-1 flex-col px-4 py-12">
      <p className="text-caption text-steel">Field Ops Reporter</p>
      <h1 className="mt-6 font-display text-title font-bold">This page doesn&rsquo;t exist</h1>
      <p className="mt-3 text-body-lg">The link may be old, or what it pointed to has been removed.</p>
      <div className="mt-8">
        <Link href="/" className={buttonClassName()}>
          Go to the start
        </Link>
      </div>
    </main>
  );
}
