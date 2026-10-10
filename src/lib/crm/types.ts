/** What a connector needs to copy one enquiry into the client's CRM. */
export type SyncLead = {
  id: string;
  firstName: string;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  source: string;
  notes: string | null;
  createdAt: Date;
};

/** "new": a lead was created. "again": a known person enquired again, `text` is their new message. */
export type SyncPayload = { type: "new" } | { type: "again"; text: string };

/**
 * permanent: retrying cannot help until someone fixes something (bad token, no access, bad sheet id) -> recorded GAVE_UP at once.
 * Everything else (timeouts, 429, 5xx) is retried by `npm run crm:retry`.
 */
export class CrmError extends Error {
  readonly permanent: boolean;
  constructor(message: string, permanent: boolean) {
    super(message);
    this.name = "CrmError";
    this.permanent = permanent;
  }
}

export function httpFailure(provider: string, status: number): CrmError {
  return new CrmError(`${provider} answered ${status}`, status !== 429 && status < 500 && status !== 408);
}

export const fullName = (l: Pick<SyncLead, "firstName" | "lastName">) => [l.firstName, l.lastName].filter(Boolean).join(" ");
