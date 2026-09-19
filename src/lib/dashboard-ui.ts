export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "•";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}

export function propertyCover(property: { id: string; propertyType: string; area?: string | null }) {
  if (property.id === "prop_dha6_92m" || property.id === "prop_dha6_1kanal") {
    return "https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=640&q=80";
  }
  if (property.id === "prop_dha5_88m") {
    return "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=640&q=80";
  }
  if (property.propertyType === "PLOT") {
    return "https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=640&q=80";
  }
  if (property.propertyType === "APARTMENT") {
    return "https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?auto=format&fit=crop&w=640&q=80";
  }
  return "https://images.unsplash.com/photo-1564013799919-ab600027ffc6?auto=format&fit=crop&w=640&q=80";
}

export const SOURCE_COLORS: Record<string, string> = {
  ZAMEEN: "#111827",
  WHATSAPP_INBOUND: "#25D366",
  FACEBOOK_ADS: "#1877F2",
  REFERRAL: "#dc3545",
  WALK_IN: "#0D6EFD",
  SIGNBOARD: "#6B7280",
  COLD_CALL: "#9CA3AF",
  EXISTING_CLIENT: "#111827",
};

export function sourceLabel(source: string) {
  switch (source) {
    case "ZAMEEN":
      return "Zameen.com";
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
