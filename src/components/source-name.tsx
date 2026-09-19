import { cn } from "@/lib/utils";
import { sourceLabel } from "@/lib/dashboard-ui";

function canonicalSource(source: string) {
  const key = source.trim();
  if (key === "WhatsApp" || key === "WHATSAPP_INBOUND") return "WHATSAPP_INBOUND";
  if (key === "Facebook/Instagram" || key === "FACEBOOK_ADS") return "FACEBOOK_ADS";
  if (key === "Zameen.com" || key === "ZAMEEN") return "ZAMEEN";
  if (key === "Referral" || key === "REFERRAL") return "REFERRAL";
  return key;
}

export function SourceName({
  source,
  className,
}: {
  source: string;
  className?: string;
}) {
  const key = canonicalSource(source);

  switch (key) {
    case "WHATSAPP_INBOUND":
      return (
        <span className={cn("font-medium text-[#25D366]", className)}>WhatsApp</span>
      );
    case "FACEBOOK_ADS":
      return (
        <span className={cn("font-medium", className)}>
          <span className="text-[#1877F2]">Facebook</span>
          <span className="text-muted">/</span>
          <span className="source-instagram">Instagram</span>
        </span>
      );
    case "ZAMEEN":
      return <span className={cn("font-bold text-black", className)}>Zameen.com</span>;
    case "REFERRAL":
      return <span className={cn("font-medium text-danger", className)}>Referral</span>;
    default:
      return <span className={cn("text-muted", className)}>{sourceLabel(source)}</span>;
  }
}
