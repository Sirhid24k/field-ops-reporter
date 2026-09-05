import type { Metadata } from "next";
import { SignInForm } from "./SignInForm";

export const metadata: Metadata = { title: "Sign in" };

type SearchParams = Promise<{ next?: string; error?: string }>;

export default async function SignInPage({ searchParams }: { searchParams: SearchParams }) {
  const { next, error } = await searchParams;

  return (
    <main className="mx-auto flex w-full max-w-[440px] flex-1 flex-col px-6 py-12">
      <p className="font-display text-heading font-bold">Field Ops Reporter</p>

      <h1 className="mt-10 font-display text-title font-bold">Sign in</h1>
      <p className="mt-3 text-body-lg text-steel">
        Enter your email and we&rsquo;ll send you a sign-in link. First time here? Use your work email and you&rsquo;ll
        set up your business next.
      </p>

      {error === "link" ? (
        <p role="alert" className="mt-6 border-l-4 border-flag pl-3 text-body text-flag">
          That sign-in link didn&rsquo;t work. It may have expired. Send a new one.
        </p>
      ) : null}

      <SignInForm next={next} />
    </main>
  );
}
