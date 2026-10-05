import { DemoWhatsAppProvider } from "./demo";
import { WhatsAppBusinessProvider } from "./business";
import { whatsappStatus } from "./mode";
import type { WhatsAppProvider } from "./types";

/**
 * Demo is chosen only when `whatsappStatus()` says demo. When live is selected but misconfigured, or nothing is
 * enabled in production, the Business provider is returned with a blocked reason so every send is stored as FAILED
 * with that reason instead of silently falling back to a fake "SENT" (INTG-008).
 */
export function getWhatsAppProvider(): WhatsAppProvider {
  const status = whatsappStatus();
  switch (status.mode) {
    case "live":
      return new WhatsAppBusinessProvider();
    case "misconfigured":
      return new WhatsAppBusinessProvider({
        blockedReason: `WhatsApp live mode is selected but not configured (missing ${status.missingOutbound.join(", ")}). Message stored in CRM but not sent.`,
      });
    case "disabled":
      return new WhatsAppBusinessProvider({
        blockedReason: "WhatsApp is not connected on this deployment. Message stored in CRM but not sent.",
      });
    case "demo":
      return new DemoWhatsAppProvider();
  }
}

export { whatsappStatus, describeWhatsAppStatus } from "./mode";
export type { WhatsAppMode, WhatsAppStatus } from "./mode";
export type { WhatsAppProvider, WhatsAppSendInput } from "./types";
