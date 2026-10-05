import { isDemoMode } from "@/lib/demo-mode";

/**
 * Which WhatsApp provider this deployment is actually running, and whether it can work (INTG-008).
 *
 * - live:          WHATSAPP_BUSINESS_ENABLED=true and the Cloud API credentials are present.
 * - misconfigured: live was selected but credentials are missing. Sends are recorded as FAILED, never demo-delivered.
 * - demo:          live not selected, and this is Demo Mode or a non-production process. Nothing leaves the CRM.
 * - disabled:      live not selected in production without Demo Mode. Sends are recorded as FAILED, never demo-delivered.
 */
export type WhatsAppMode = "live" | "misconfigured" | "demo" | "disabled";

export type WhatsAppStatus = {
  mode: WhatsAppMode;
  /** Env var NAMES (never values) still needed to send. */
  missingOutbound: string[];
  /** Env var names still needed to accept inbound webhooks (only reported when live is selected). */
  missingInbound: string[];
};

export function whatsappStatus(env: NodeJS.ProcessEnv = process.env): WhatsAppStatus {
  const selected = env.WHATSAPP_BUSINESS_ENABLED === "true";
  const missingOutbound = ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID"].filter((k) => !env[k]);
  const missingInbound = ["WHATSAPP_APP_SECRET", "WHATSAPP_VERIFY_TOKEN"].filter((k) => !env[k]);

  if (selected) {
    return { mode: missingOutbound.length === 0 ? "live" : "misconfigured", missingOutbound, missingInbound };
  }
  const demoAllowed = isDemoMode() || env.NODE_ENV !== "production";
  return { mode: demoAllowed ? "demo" : "disabled", missingOutbound: [], missingInbound: [] };
}

/** One-sentence, user-facing description. Contains env var names only, never values. */
export function describeWhatsAppStatus(status: WhatsAppStatus): string {
  switch (status.mode) {
    case "demo":
      return "Demo provider. Messages are recorded in the CRM only; nothing is sent to WhatsApp.";
    case "disabled":
      return "Not connected. Messages are recorded as Failed because no WhatsApp provider is enabled on this deployment.";
    case "misconfigured":
      return `Live mode is selected but not configured (missing ${status.missingOutbound.join(", ")}). Messages are recorded as Failed until it is fixed.`;
    case "live":
      return status.missingInbound.length
        ? `Live (Meta WhatsApp Business Cloud API) for sending. Incoming messages are not accepted until ${status.missingInbound.join(" and ")} ${status.missingInbound.length > 1 ? "are" : "is"} set.`
        : "Live (Meta WhatsApp Business Cloud API). Messages sent here go to real customers. Delivery is reported by Meta and has not been verified by this app.";
  }
}
