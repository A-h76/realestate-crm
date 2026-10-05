import type { Instrumentation } from "next";

/**
 * Runs once when the server starts, before it takes requests. In production an invalid configuration (OPS-003)
 * stops the process (exit code 1), so Railway marks the deploy failed and keeps the previous release instead of serving
 * a broken one. Never runs the check during `next build`: build machines do not always have runtime secrets.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === "phase-production-build") return;
  const { validateEnv } = await import("@/lib/env");
  const { logEvent } = await import("@/lib/log");

  const report = validateEnv();
  logEvent(report.errors.length ? "error" : "info", "startup_config", {
    mode: report.mode,
    errors: report.errors.map((e) => `${e.key} ${e.problem}`),
    warnings: report.warnings.map((w) => `${w.key} ${w.problem}`),
  });
  if (report.errors.length > 0 && process.env.NODE_ENV === "production") {
    // Exit rather than throw: a throw here leaves the process alive but never listening, which looks like a hang.
    // The startup_config line above already names every problem (keys and rules, never values).
    process.exit(1);
  }
}

/** Server-side render and route errors, with the digest the user sees on the error page so the two can be matched. */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  const { logEvent } = await import("@/lib/log");
  logEvent("error", "request_error", {
    digest: (error as { digest?: string }).digest,
    error: error instanceof Error ? error : "non-error value thrown",
    method: request.method,
    path: request.path.split("?")[0],
    routeType: context.routeType,
    routePath: context.routePath,
  });
};
