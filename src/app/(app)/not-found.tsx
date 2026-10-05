import { NotFoundState } from "@/components/route-states";

// Rendered by notFound() in the detail pages (lead, contact, account, opportunity, property) inside the app shell.
export default function AppNotFound() {
  return (
    <NotFoundState
      links={[
        { href: "/leads", label: "Leads" },
        { href: "/opportunities", label: "Opportunities" },
      ]}
    />
  );
}
