import { DemoCalendarProvider } from "./demo";
import { GoogleCalendarProvider } from "./google";
import type { CalendarProvider } from "./types";

export function getCalendarProvider(): CalendarProvider {
  const googleEnabled = process.env.GOOGLE_CALENDAR_ENABLED === "true";
  const hasCreds = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

  if (googleEnabled && hasCreds) {
    return new GoogleCalendarProvider();
  }

  return new DemoCalendarProvider();
}

export type { CalendarProvider, CalendarEventInput } from "./types";
