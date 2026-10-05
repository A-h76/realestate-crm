"use client";

// Last resort: replaces the root layout, so it needs its own <html>/<body> and cannot rely on global CSS.
// Shows no error message or stack - only the opaque digest that matches the server log.
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#fff", color: "#111" }}>
        <title>Something went wrong</title>
        <main role="alert" style={{ maxWidth: 520, margin: "20vh auto", padding: 24 }}>
          <h1 style={{ fontSize: 24, margin: "0 0 12px" }}>Something went wrong</h1>
          <p style={{ lineHeight: 1.5, color: "#444" }}>
            The application hit an unexpected problem. Your data has not been changed. Try again, and if it keeps
            happening, contact your administrator{error.digest ? " and quote the reference below" : ""}.
          </p>
          {error.digest ? <p style={{ fontFamily: "monospace", fontSize: 12, color: "#555" }}>Reference: {error.digest}</p> : null}
          <button
            type="button"
            onClick={() => retry()}
            style={{ padding: "8px 16px", fontSize: 14, cursor: "pointer", border: "1px solid #111", background: "#111", color: "#fff", borderRadius: 8 }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
