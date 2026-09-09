"use client";

/** Only reached when the root layout itself fails; it has to render its own html and body. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, padding: "48px 16px", fontFamily: "Barlow, sans-serif", background: "#f8f8f4", color: "#161c1b" }}>
        <main style={{ maxWidth: 480, margin: "0 auto" }}>
          <p style={{ fontSize: 13, color: "#6e7573" }}>Field Ops Reporter</p>
          <h1 style={{ fontSize: 30, lineHeight: "32px", marginTop: 24 }}>Something went wrong</h1>
          <p style={{ fontSize: 17, lineHeight: "24px", marginTop: 12 }}>The app couldn&rsquo;t load. Nothing you sent has been lost.</p>
          <p style={{ marginTop: 32 }}>
            <button
              type="button"
              onClick={reset}
              style={{ minHeight: 48, padding: "0 20px", border: "1px solid #161c1b", borderRadius: 6, background: "#161c1b", color: "#f8f8f4", fontSize: 17, cursor: "pointer" }}
            >
              Try again
            </button>
          </p>
          {error.digest ? <p style={{ marginTop: 32, fontSize: 13, color: "#6e7573" }}>Reference {error.digest}</p> : null}
        </main>
      </body>
    </html>
  );
}
