import type { PackageId } from "./packages";

/**
 * Industry packs: the words, stages and intake questions that make the same core read as a clinic, school or
 * shop. Adding an industry is adding an entry here, no migration (Workspace.industry is a plain string).
 * `proven` = used by a real client or exercised end to end; the rest are drafted and flagged as such on the sales sheet.
 */
export const INDUSTRY_IDS = [
  "general",
  "real_estate",
  "retail",
  "clinic",
  "hospital",
  "pharmacy",
  "coaching",
  "school",
  "college",
] as const;
export type IndustryId = (typeof INDUSTRY_IDS)[number];

export type Industry = {
  id: IndustryId;
  name: string;
  group: "General" | "Sales" | "Healthcare" | "Education";
  startsWith: PackageId;
  proven: boolean;
  /** Plural noun for the thing that comes in ("Leads", "Enquiries"). */
  leadsLabel: string;
  /** Sidebar subtitle. */
  tagline: string;
  /** Search box hint. */
  searchHint: string;
  /** Sidebar hrefs that make no sense for this industry. */
  hideNav: readonly string[];
  /** What an enquiry is, in one line, for the sales sheet. */
  enquiry: string;
  stages: readonly string[];
  /** Questions the intake form / assistant should ask. Not stored yet: needs the intake endpoint (step 4). */
  intake: readonly string[];
  /** Industry-specific deliverable on top of the package. */
  extra: string;
  /** Rule the system must respect for this industry, or null. */
  compliance: string | null;
};

const NO_LISTINGS = ["/properties", "/proposals"] as const;

export const INDUSTRIES: Record<IndustryId, Industry> = {
  general: {
    id: "general",
    name: "Any business",
    group: "General",
    startsWith: "starter",
    proven: false,
    leadsLabel: "Enquiries",
    tagline: "Enquiry-to-customer CRM",
    searchHint: "Search enquiries, contacts…",
    hideNav: NO_LISTINGS,
    enquiry: "Anyone asking about what you sell",
    stages: ["New", "Contacted", "Qualified", "Won", "Lost"],
    intake: ["What do you need?", "Budget", "When do you need it?"],
    extra: "Stages and questions agreed on the audit call",
    compliance: null,
  },
  real_estate: {
    id: "real_estate",
    name: "Real estate",
    group: "Sales",
    startsWith: "growth",
    proven: true,
    leadsLabel: "Leads",
    tagline: "US Residential Real Estate CRM",
    searchHint: "Search leads, properties, deals…",
    hideNav: [],
    enquiry: "Buyer, seller or renter asking about a listing",
    stages: ["New", "Contacted", "Showing", "Offer", "Closed"],
    intake: ["Buy, sell or rent", "Area", "Budget", "Timeline"],
    extra: "Property listings, property matching, showings, proposals",
    compliance: "Text and email consent (TCPA, 10DLC) before automated messages",
  },
  retail: {
    id: "retail",
    name: "Retail store",
    group: "Sales",
    startsWith: "starter",
    proven: false,
    leadsLabel: "Enquiries",
    tagline: "Store enquiry CRM",
    searchHint: "Search enquiries, contacts…",
    hideNav: NO_LISTINGS,
    enquiry: "Product enquiry or visit request",
    stages: ["New", "Contacted", "Visit or order", "Won", "Lost"],
    intake: ["Product interest", "Budget", "Visit or delivery"],
    extra: "Product-interest tagging, instant reply with opening hours",
    compliance: null,
  },
  clinic: {
    id: "clinic",
    name: "Clinic",
    group: "Healthcare",
    startsWith: "growth",
    proven: false,
    leadsLabel: "Patient enquiries",
    tagline: "Clinic enquiry and booking CRM",
    searchHint: "Search patient enquiries, contacts…",
    hideNav: [...NO_LISTINGS, "/opportunities"],
    enquiry: "Appointment request or question from a patient",
    stages: ["New", "Contacted", "Booked", "Attended", "Follow-up"],
    intake: ["Service needed", "Preferred doctor", "Preferred day and time", "New or existing patient"],
    extra: "Booking-first flow on the calendar, appointment reminders, no-show follow-up",
    compliance: "AI books and answers logistics only, never medical advice. No clinical details over chat. US patients: HIPAA review before go-live",
  },
  hospital: {
    id: "hospital",
    name: "Hospital",
    group: "Healthcare",
    startsWith: "advanced",
    proven: false,
    leadsLabel: "Patient enquiries",
    tagline: "Hospital enquiry routing CRM",
    searchHint: "Search patient enquiries, contacts…",
    hideNav: [...NO_LISTINGS, "/opportunities"],
    enquiry: "Department or specialist enquiry, often across branches",
    stages: ["New", "Routed to department", "Booked", "Attended", "Follow-up"],
    intake: ["Department", "Urgency", "Branch", "New or existing patient"],
    extra: "Department and branch routing, approvals, manager dashboards",
    compliance: "AI books and answers logistics only, never medical advice. US patients: HIPAA review before go-live",
  },
  pharmacy: {
    id: "pharmacy",
    name: "Pharmacy",
    group: "Healthcare",
    startsWith: "starter",
    proven: false,
    leadsLabel: "Enquiries",
    tagline: "Pharmacy enquiry CRM",
    searchHint: "Search enquiries, contacts…",
    hideNav: [...NO_LISTINGS, "/opportunities"],
    enquiry: "Product availability or refill question",
    stages: ["New", "Replied", "Pickup or delivery", "Done"],
    intake: ["Product", "Pickup or delivery"],
    extra: "Availability reply templates, pickup and delivery tagging",
    compliance: "No prescription or health details over chat",
  },
  coaching: {
    id: "coaching",
    name: "Coaching centre",
    group: "Education",
    startsWith: "growth",
    proven: false,
    leadsLabel: "Enquiries",
    tagline: "Coaching enquiry and enrolment CRM",
    searchHint: "Search enquiries, contacts…",
    hideNav: [...NO_LISTINGS, "/opportunities"],
    enquiry: "Course enquiry from a student or parent",
    stages: ["New", "Contacted", "Demo class", "Enrolled", "Lost"],
    intake: ["Course", "Level", "Student or parent", "Preferred batch"],
    extra: "Demo-class booking, fee follow-up reminders",
    compliance: "Parental consent when the student is a minor",
  },
  school: {
    id: "school",
    name: "School",
    group: "Education",
    startsWith: "growth",
    proven: false,
    leadsLabel: "Admission enquiries",
    tagline: "School admissions CRM",
    searchHint: "Search admission enquiries, contacts…",
    hideNav: [...NO_LISTINGS, "/opportunities"],
    enquiry: "Admission enquiry from a parent",
    stages: ["New", "Contacted", "Campus visit", "Applied", "Enrolled"],
    intake: ["Child's grade", "Start year", "Parent contact", "Current school"],
    extra: "Campus-visit booking, application reminders",
    compliance: "Children's data: store only what admissions needs; parent consent (FERPA/COPPA where applicable)",
  },
  college: {
    id: "college",
    name: "College",
    group: "Education",
    startsWith: "advanced",
    proven: false,
    leadsLabel: "Applicant enquiries",
    tagline: "College admissions CRM",
    searchHint: "Search applicant enquiries, contacts…",
    hideNav: [...NO_LISTINGS, "/opportunities"],
    enquiry: "Programme enquiry and application follow-up",
    stages: ["Enquiry", "Counselling", "Applied", "Admitted", "Enrolled"],
    intake: ["Programme", "Intake year", "Qualification", "Country"],
    extra: "Counsellor teams, approvals, programme-based routing, manager dashboards",
    compliance: "Applicant data handling (FERPA where applicable)",
  },
};

export function industryOf(id: string): Industry {
  return Object.hasOwn(INDUSTRIES, id) ? INDUSTRIES[id as IndustryId] : INDUSTRIES.general;
}
