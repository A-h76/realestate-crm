import { DemoWhatsAppProvider } from "./demo";
import { WhatsAppBusinessProvider } from "./business";
import type { WhatsAppProvider } from "./types";

export function getWhatsAppProvider(): WhatsAppProvider {
  const enabled = process.env.WHATSAPP_BUSINESS_ENABLED === "true";
  const hasCreds = Boolean(
    process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID,
  );

  if (enabled && hasCreds) {
    return new WhatsAppBusinessProvider();
  }

  return new DemoWhatsAppProvider();
}

export type { WhatsAppProvider, WhatsAppSendInput } from "./types";
