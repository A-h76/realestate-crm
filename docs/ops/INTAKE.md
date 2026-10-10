# Enquiry intake: website form, Meta lead ads, inbound email

All three feed one path (`src/lib/intake/ingest.ts`): the lead is created and owned at intake, the team is alerted, the
enquirer gets an instant reply email, and a person who enquires again becomes a note on their lead, not a second lead.
Sources are registered per client by the operator (`npm run intake`), never self-service. A package includes a number of
channels (Starter 1, Growth 4): the command refuses to go over unless you pass `--force` for something agreed in writing.

Per-deployment environment (the client pays Resend and Meta directly):

| Variable | Used for |
|---|---|
| `RESEND_API_KEY`, `ALERT_FROM_EMAIL` | sending alerts and the instant reply; both or neither |
| `ENQUIRY_REPLY_TO` | optional: the client's real inbox, so a customer replying to the instant reply reaches a person |
| `RESEND_WEBHOOK_SECRET` | inbound email: the `whsec_...` signing secret of the Resend webhook |
| `META_APP_SECRET`, `META_VERIFY_TOKEN`, `META_PAGE_ACCESS_TOKEN` | Meta lead ads (all three) |

## Website form

```
npm run intake -- add-form <workspace-slug> "Contact page" https://their-site.example
```

Prints the endpoint and a paste-in snippet. Only the listed origins can post from a browser; with none listed only
server-to-server posts work. Extra fields in the form (service wanted, preferred time) are kept in the lead's notes.
A hidden `hp_url` field is a spam trap. There is no CAPTCHA: add Cloudflare Turnstile when a form attracts spam.

## Facebook / Instagram lead ads

1. In the client's Meta app: subscribe the Page to the `leadgen` field, callback `https://<app>/api/webhooks/meta`, verify token = `META_VERIFY_TOKEN`.
2. The app needs the lead-retrieval permission approved by Meta (App Review) before live leads flow. Test leads work earlier. Check Meta's current docs for the exact permission names.
3. Generate a Page access token, set `META_PAGE_ACCESS_TOKEN`.
4. `npm run intake -- add-meta <workspace-slug> <page id> "Spring promo"`

If reading a lead from Meta fails, the webhook answers 5xx and Meta retries; a lead is never created twice.

## Inbound email

1. In Resend, receive mail on a custom domain (MX record) or on the account's `*.resend.app` address, and add a webhook for `email.received` to `https://<app>/api/webhooks/resend`. Copy its signing secret to `RESEND_WEBHOOK_SECRET`.
2. The client forwards `info@theirshop.com` to that address.
3. `npm run intake -- add-email <workspace-slug> <the receiving address> "Info mailbox"`

No-reply senders and auto-replies are dropped. Replies are notes on the lead; answering is still done from the team's own
mail client. A threaded email inbox is not built.
