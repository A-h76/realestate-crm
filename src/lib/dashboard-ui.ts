export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "•";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}

export function propertyCover(property: { id: string; propertyType: string; area?: string | null }) {
  if (property.propertyType === "LAND") {
    return "https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=640&q=80";
  }
  if (property.propertyType === "CONDO") {
    return "https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?auto=format&fit=crop&w=640&q=80";
  }
  return "https://images.unsplash.com/photo-1564013799919-ab600027ffc6?auto=format&fit=crop&w=640&q=80";
}

export const SOURCE_COLORS: Record<string, string> = {
  ZILLOW: "#006AFF",
  REALTOR_COM: "#D92228",
  HOMES_COM: "#1C7C54",
  WEB_FORM: "#0D9488",
  OPEN_HOUSE: "#B45309",
  SIGN_CALL: "#6B7280",
  AGENT_REFERRAL: "#7C3AED",
  WHATSAPP_INBOUND: "#25D366",
  FACEBOOK_ADS: "#1877F2",
  REFERRAL: "#dc3545",
  WALK_IN: "#0D6EFD",
  COLD_CALL: "#9CA3AF",
  EXISTING_CLIENT: "#111827",
  GOOGLE_ADS: "#4285F4",
  PHONE: "#6B7280",
  MANUAL: "#9CA3AF",
  OTHER: "#9CA3AF",
};

export function sourceLabel(source: string) {
  switch (source) {
    case "ZILLOW":
      return "Zillow";
    case "REALTOR_COM":
      return "Realtor.com";
    case "HOMES_COM":
      return "Homes.com";
    case "WEB_FORM":
      return "Website form";
    case "GOOGLE_ADS":
      return "Google";
    case "PHONE":
      return "Phone";
    case "MANUAL":
      return "Manual entry";
    case "OPEN_HOUSE":
      return "Open house";
    case "SIGN_CALL":
      return "Sign call";
    case "AGENT_REFERRAL":
      return "Agent referral";
    case "WHATSAPP_INBOUND":
      return "WhatsApp";
    case "FACEBOOK_ADS":
      return "Facebook/Instagram";
    case "WALK_IN":
      return "Walk-in";
    case "EXISTING_CLIENT":
      return "Existing client";
    case "COLD_CALL":
      return "Cold call";
    default:
      return source.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  }
}
