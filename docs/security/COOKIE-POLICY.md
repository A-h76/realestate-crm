# Cookie Policy

This inventory is based only on cookies observed from the running application (2026-09-27) and on the code in `src/lib/auth.ts` and Auth.js v5 defaults. The CRM sets **no analytics, advertising, tracking, or preference cookies**, and it does not use `localStorage`, `sessionStorage` or IndexedDB. Every cookie below is set by Auth.js, the authentication library.

"Production" means `NODE_ENV=production` over HTTPS. Prefixed names (`__Host-`, `__Secure-`) require `Secure`.

## Technical inventory

| Name (production / development) | Purpose | Category | Essential | Lifetime | HttpOnly | Secure | SameSite | Domain | Path | Contains |
|---|---|---|---|---|---|---|---|---|---|---|
| `__Host-synas_session` / `synas_session` | Keeps you signed in | Strictly necessary: authentication | Yes | Rolling 8h from last activity (re-issued at most every 15 min). The server-side session behind it ends after 12h absolute, on sign-out, or when your workspace access is removed | Yes | Yes (prod) | Lax | Not set (host-only) | `/` | An encrypted token (JWE, A256CBC-HS512). Inside: your user id, workspace id, role, name, email, and a random session id. It can't be read or altered without the server's `AUTH_SECRET`. No password, no provider tokens |
| `__Host-authjs.csrf-token` / `authjs.csrf-token` | Stops other sites submitting the sign-in / sign-out forms (double-submit CSRF token) | Strictly necessary: security | Yes | Browser session | Yes | Yes (prod) | Lax | Not set | `/` | A random token and its hash. No personal data |
| `__Secure-authjs.callback-url` / `authjs.callback-url` | Remembers which in-app page to return to after sign-in | Strictly necessary: authentication | Yes | Browser session | Yes | Yes (prod) | Lax | Not set | `/` | A same-site URL path. No personal data |

When an encrypted session token exceeds the browser's per-cookie size limit, Auth.js splits it into chunks (`…session.0`, `…session.1`) with identical attributes. This doesn't happen with the current token size.

### Why these settings

- **HttpOnly:** page JavaScript can't read any auth cookie, which limits what an XSS bug could steal.
- **Secure + `__Host-` prefix:** the session cookie is sent only over HTTPS, and a subdomain can't set or overwrite it (no `Domain`, `Path=/`).
- **SameSite=Lax:** the browser doesn't attach the cookie to cross-site POST/PATCH/DELETE requests, and it still lets links from WhatsApp or email open the CRM while signed in. We chose Lax over Strict for that reason. A server-side Origin check on every API mutation backs it up (`src/proxy.ts`).
- **No credentials in cookies:** passwords, API keys, database credentials, OAuth/Google secrets and WhatsApp tokens are never placed in cookies. They exist only as server environment variables.
- **Not stored elsewhere:** session credentials are never put in `localStorage`, `sessionStorage` or URL parameters.

### Not framework-default

The session cookie name was changed from Auth.js's `__Secure-authjs.session-token` to `__Host-synas_session` (stricter prefix). The CSRF and callback cookies keep the Auth.js defaults because the framework manages them.

---

## User-facing cookie notice

> **Cookies on the Synas Lead-to-Sale CRM**
>
> We use only the cookies needed to sign you in and keep your account secure. There are three, and they are all strictly necessary:
>
> - **A sign-in cookie** that keeps you logged in. It expires after 8 hours without activity, and your session ends after at most 12 hours, when you sign out, or when an administrator removes your access.
> - **A security cookie** that protects the sign-in and sign-out forms from being submitted by other websites. It is deleted when you close your browser.
> - **A return-page cookie** that sends you back to the page you were on after signing in. It is deleted when you close your browser.
>
> These cookies can't be read by scripts on the page, are sent only over encrypted connections, and are never shared with other websites. We don't use cookies for analytics, advertising or tracking. Because these cookies are required for the CRM to work, there is no option to turn them off. Blocking them in your browser will prevent you from signing in.

This notice describes the implementation only. Whether it satisfies a particular jurisdiction's consent or disclosure rules is a question for legal review.
