import { Badge } from "@/components/ui/badge";

export type MemberInvitation = { state: "PENDING" | "EXPIRED"; expiresAt: string };

/** Shown next to a member who has not finished setting their password. Renders nothing for active members. */
export function InvitationBadge({ invitation }: { invitation: MemberInvitation | null }) {
  if (!invitation) return null;
  const pending = invitation.state === "PENDING";
  return (
    <Badge tone={pending ? "warning" : "danger"} className="ml-2">
      {pending
        ? `Invitation pending, link valid until ${new Date(invitation.expiresAt).toISOString().slice(0, 10)}`
        : "Invitation expired, create a new setup link"}
    </Badge>
  );
}
