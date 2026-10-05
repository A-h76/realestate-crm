import { SettingsView } from "../settings/settings-view";

export default function TeamPage() {
  return (
    <SettingsView
      eyebrow="Team"
      title="Team"
      description="Agents, managers and admins on your team, their roles, and invitations."
      tabs={["team"]}
    />
  );
}
