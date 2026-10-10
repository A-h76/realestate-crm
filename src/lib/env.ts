/**
 * Runtime configuration check (OPS-003). One place that says which settings are required, which are optional, and
 * what mode the process is in, so a bad deployment fails at start-up with a clear message instead of deep inside a
 * request. Problems name the variable and the rule, NEVER the value.
 *
 * Errors stop a production process from starting. Warnings are logged and never block (an optional integration that
 * is half-configured already fails safely where it is used, e.g. WhatsApp sends are recorded as Failed).
 */
export type EnvIssue = { key: string; problem: string };
export type EnvReport = {
  mode: "production" | "demo" | "development" | "test";
  errors: EnvIssue[];
  warnings: EnvIssue[];
};

const AUTH_SECRET_PLACEHOLDERS = [/generate-a-secure-secret/i, /ci-only-secret/i, /change[-_ ]?me/i, /^secret$/i, /your[-_ ]?secret/i];

function isUrl(value: string, protocols: string[]): boolean {
  try {
    return protocols.includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

export function validateEnv(env: NodeJS.ProcessEnv = process.env): EnvReport {
  const production = env.NODE_ENV === "production";
  const demo = env.DEMO_MODE === "true";
  const errors: EnvIssue[] = [];
  const warnings: EnvIssue[] = [];
  const err = (key: string, problem: string) => errors.push({ key, problem });
  const warn = (key: string, problem: string) => warnings.push({ key, problem });

  // Required everywhere
  if (!env.DATABASE_URL) err("DATABASE_URL", "is required");
  else if (!isUrl(env.DATABASE_URL, ["postgres:", "postgresql:"])) err("DATABASE_URL", "must be a postgres:// or postgresql:// URL");

  if (!env.AUTH_SECRET) err("AUTH_SECRET", "is required");
  else if (production) {
    if (env.AUTH_SECRET.length < 32) err("AUTH_SECRET", "must be at least 32 characters in production");
    else if (AUTH_SECRET_PLACEHOLDERS.some((re) => re.test(env.AUTH_SECRET!))) err("AUTH_SECRET", "is still a placeholder value; generate a unique secret per environment");
  }

  // Public URL: Auth.js needs it to build callback and cookie settings correctly
  const authUrl = env.AUTH_URL ?? env.NEXTAUTH_URL;
  if (production && !authUrl) err("AUTH_URL", "is required in production (or NEXTAUTH_URL)");
  else if (authUrl && !isUrl(authUrl, ["http:", "https:"])) err("AUTH_URL", "must be an http(s) URL");
  else if (production && authUrl && !authUrl.startsWith("https://")) warn("AUTH_URL", "is not https in production; secure cookies and HSTS will not work as intended");

  // Mode flags
  if (env.DEMO_MODE !== undefined && env.DEMO_MODE !== "true" && env.DEMO_MODE !== "false") warn("DEMO_MODE", 'is neither "true" nor "false"; it is treated as off');
  if (production && demo) warn("DEMO_MODE", "is on in a production build: demo endpoints and the demo WhatsApp provider are enabled. Do not use real customer data in this deployment");
  if (production && env.DISABLE_HSTS === "true") warn("DISABLE_HSTS", "is true in production; the Strict-Transport-Security header is not sent");

  // Optional integrations: reported, never fatal
  if (env.WHATSAPP_BUSINESS_ENABLED === "true") {
    for (const k of ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID"]) if (!env[k]) warn(k, "is required for live WhatsApp sending; sends will be recorded as Failed");
    for (const k of ["WHATSAPP_APP_SECRET", "WHATSAPP_VERIFY_TOKEN"]) if (!env[k]) warn(k, "is required to receive WhatsApp webhooks; they are rejected until it is set");
    if (!env.WHATSAPP_WORKSPACE_ID) warn("WHATSAPP_WORKSPACE_ID", "is unset; inbound messages resolve a workspace only through a stored integration row");
  }
  if (Boolean(env.RESEND_API_KEY) !== Boolean(env.ALERT_FROM_EMAIL)) warn("RESEND_API_KEY", "and ALERT_FROM_EMAIL must be set together (sender on a domain verified in Resend); email alerts stay off until both are set");
  if (env.META_APP_SECRET || env.META_PAGE_ACCESS_TOKEN || env.META_VERIFY_TOKEN) {
    for (const k of ["META_APP_SECRET", "META_VERIFY_TOKEN", "META_PAGE_ACCESS_TOKEN"]) if (!env[k]) warn(k, "is required for Meta lead ads; the webhook rejects or cannot read leads until it is set");
  }
  if (env.RESEND_WEBHOOK_SECRET && !env.RESEND_API_KEY) warn("RESEND_API_KEY", "is required to read inbound email bodies; inbound webhooks answer 502 until it is set");
  if (Boolean(env.GOOGLE_SERVICE_ACCOUNT_EMAIL) !== Boolean(env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY)) warn("GOOGLE_SERVICE_ACCOUNT_EMAIL", "and GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY must be set together; Google Sheets copying stays off until both are set");
  if (env.WHATSAPP_GRAPH_API_VERSION && !/^v\d+\.\d+$/.test(env.WHATSAPP_GRAPH_API_VERSION)) warn("WHATSAPP_GRAPH_API_VERSION", 'should look like "v21.0"; using it as given');
  if (Boolean(env.UPSTASH_REDIS_REST_URL) !== Boolean(env.UPSTASH_REDIS_REST_TOKEN)) warn("UPSTASH_REDIS_REST_URL", "and UPSTASH_REDIS_REST_TOKEN must be set together; the PostgreSQL rate limiter is used");
  if (env.UPSTASH_REDIS_REST_URL && !isUrl(env.UPSTASH_REDIS_REST_URL, ["https:"])) warn("UPSTASH_REDIS_REST_URL", "should be an https URL");

  return { mode: production ? (demo ? "demo" : "production") : env.NODE_ENV === "test" ? "test" : "development", errors, warnings };
}

/** Throws (naming keys and rules only) when there are errors. */
export function assertValidEnv(env: NodeJS.ProcessEnv = process.env): EnvReport {
  const report = validateEnv(env);
  if (report.errors.length > 0) {
    throw new Error(`Invalid configuration: ${report.errors.map((e) => `${e.key} ${e.problem}`).join("; ")}`);
  }
  return report;
}
