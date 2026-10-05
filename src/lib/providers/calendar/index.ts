import { DemoCalendarProvider } from "./demo";
import type { CalendarProvider } from "./types";

/**
 * INTG-012: the calendar is internal — events live only in the CRM database.
 * No external calendar provider (Google or otherwise) is implemented; add a
 * real provider here only once its OAuth/sync design is approved.
 */
export function getCalendarProvider(): CalendarProvider {
  return new DemoCalendarProvider();
}

export type { CalendarProvider, CalendarEventInput } from "./types";
