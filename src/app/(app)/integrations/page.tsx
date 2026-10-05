import { SettingsView } from "../settings/settings-view";

export default function IntegrationsPage() {
  return (
    <SettingsView
      eyebrow="Integrations"
      title="Integrations"
      description="Which messaging and calendar providers are connected. Nothing is listed as connected unless it is."
      tabs={["integrations"]}
    />
  );
}
