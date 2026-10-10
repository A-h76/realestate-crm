# Copying enquiries into the client's own CRM (Starter)

Starter promises "every enquiry saved in your own CRM". When a workspace has a connection, every new lead (from any
channel) and every repeat enquiry is copied into the client's HubSpot or Google Sheet, in addition to being saved here.
The copy is attempted right after the lead is saved and never blocks or loses the lead. Failures are recorded and retried.

Credentials are per-deployment environment variables (one deployment per client), never stored in the database.

## HubSpot

1. In the client's HubSpot: Settings > Integrations > Private Apps > create an app with scopes `crm.objects.contacts.read` and `crm.objects.contacts.write`. Copy the access token.
2. Set `HUBSPOT_ACCESS_TOKEN` in the deployment.
3. `npm run crm -- connect-hubspot <workspace-slug>` (proves the token works before saving).

What it does: finds the contact by email; creates it (lifecycle stage Lead, lead status New) if missing; never overwrites an existing contact; adds the enquiry as a note on the contact. A lead with no email always creates a new contact.

## Google Sheets

1. In Google Cloud: create a service account and a JSON key. Put its `client_email` in `GOOGLE_SERVICE_ACCOUNT_EMAIL` and its `private_key` in `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` (the `\n` sequences can stay as they are). Enable the Google Sheets API on the project.
2. The client shares their sheet with the service account email as **Editor**.
3. `npm run crm -- connect-sheets <workspace-slug> "<sheet url>" ["Tab name"]` (checks access, writes the header row if the sheet is empty).

Columns: Received, Type (New enquiry / Enquired again), Name, Email, Phone, Company, Source, Message, Link. Values that start with `= + - @` are stored as text so a website visitor cannot plant a formula.

## Operating it

- `npm run crm -- list <workspace-slug>` shows each connection and how many copies are SENT / FAILED / GAVE_UP.
- `npm run crm:retry` retries failed copies. Run it every 5 minutes as a Railway Cron Job (see SCHEDULED-AUTOMATIONS.md). It appears in Team Health > Background jobs.
- A copy is GAVE_UP after 5 attempts, or at once for a problem only a person can fix (revoked token, sheet not shared). The workspace owners get one in-app notice per connection per day. After fixing the cause: `npm run crm:retry -- --requeue`.
- The sheet copy is at-least-once: if Google saves a row but the answer is lost, the retry adds it again.

Not built: Zoho (needs an OAuth sign-in flow), syncing changes made later in the client's CRM back to us.
