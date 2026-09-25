# Google Workspace OAuth client — handoff

## Status

**Action required from a Campo Digital Google Workspace administrator** in
the Google Cloud console of the `campodigital.cl` organization. Platform
engineering does not create the client and does not handle its secret
outside the deployment's secret store.

The application side is implemented and tested against locally signed tokens
and a fake provider ([ADR-008](../adr/ADR-008-google-workspace-sign-in.md)).
**No real Google sign-in has run yet.**

## What to create

1. **APIs & Services → OAuth consent screen**
   - User type: **Internal** (restricts sign-in to `campodigital.cl` at the
     Google end; the API independently requires the verified `hd` claim).
   - Scopes: **`openid`, `email`, `profile` only.**
2. **APIs & Services → Credentials → Create credentials → OAuth client ID**
   - Application type: **Web application**.
   - **Authorized redirect URIs** — the browser-facing base that routes to
     the API, plus `/auth/google/callback`. It must match byte for byte
     (scheme, host, port, path, no trailing slash):
     - Local, through the portal dev proxy:
       `http://localhost:5100/api/auth/google/callback`
     - Hosted: `https://<portal public domain>/api/auth/google/callback`
       — the portal's own origin, because the portal proxies `/api/*` to the
       API and the session cookie must be first-party to the portal.
   - Authorized JavaScript origins: leave empty. No browser code talks to
     Google.
3. Hand the **Client ID** and **Client secret** to whoever configures the
   deployment's secret store, over a secure channel.

## Environment variables

| Variable | Required | Value |
|---|---|---|
| `GOOGLE_CLIENT_ID` | production | From step 3. |
| `GOOGLE_CLIENT_SECRET` | production | From step 3. Secret. |
| `GOOGLE_REDIRECT_BASE_URL` | production (`https://`) | The redirect URI above minus `/auth/google/callback`, e.g. `https://<portal public domain>/api`. Default `http://localhost:8000`. |
| `GOOGLE_WORKSPACE_DOMAIN` | no | `campodigital.cl` (default). The exact `hd` claim accepted. |
| `PLATFORM_TOKEN_ENCRYPTION_KEY` | production | A Fernet key: `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`. Secret. |
| `PLATFORM_BOOTSTRAP_ADMIN_EMAIL` | no (pair) | One `campodigital.cl` address to receive ADMIN at its first sign-in. |
| `PLATFORM_BOOTSTRAP_ADMIN_PRODUCTS` | no (pair) | Comma-separated subset of `lidar`, `forestry`, `transelect`. |

Under `APP_ENV=production` the API refuses to start if the client ID,
secret, or a valid Fernet key is missing, if the redirect base is not
`https://`, or if only one of the bootstrap pair is set. In other
environments, missing Google configuration makes the sign-in routes answer
`503`.

## Initial permissions

Signing in grants nothing. The configured bootstrap address receives ADMIN on
the configured products at its first sign-in, only while it holds no grant;
a later demotion is not undone by signing in again. Every other account
receives a session and `403` until a grant exists in
`platform.product_grant`. Main has no grant-management API yet, so further
grants are an operator database action for now.

## Still pending

- The hosted public domain, and therefore the exact hosted redirect URI.
- One real end-to-end sign-in with a `campodigital.cl` account.

## Related documentation

[Platform documentation](README.md) ·
[Security model](security-model.md) ·
[ADR-008 — Google Workspace sign-in](../adr/ADR-008-google-workspace-sign-in.md)
