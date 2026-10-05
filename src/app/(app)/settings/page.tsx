import { SettingsView } from "./settings-view";

export default function SettingsPage() {
  return (
    <SettingsView
      eyebrow="Office"
      title="Settings"
      description="Office details, pipeline stages, and branding."
      tabs={["workspace", "pipeline", "branding"]}
    />
  );
}
