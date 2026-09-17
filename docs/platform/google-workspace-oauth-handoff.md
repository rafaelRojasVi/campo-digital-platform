# Google Workspace OAuth client — handoff for Campo Digital

## Status

**Action required from a Campo Digital Google Workspace administrator**
(Javier), in the Google Cloud console for the `campodigital.cl` Workspace.
Platform engineering cannot perform these steps.

The application side is complete and tested (see
`../adr/ADR-010-google-workspace-sign-in-for-transelec.md`), against
locally-signed tokens and a fake provider. **No real Google sign-in has ever
run.** One item below — the exact redirect URI — cannot be finalised until
the pilot's public domain is decided.

## Why Google rather than Microsoft

`entra-app-registration-handoff.md` established that no Campo Digital
Microsoft Entra tenant exists, and creating one needs an Azure sign-up with
card verification. Campo Digital already operates Google Workspace on
`campodigital.cl`. For the Transelec pilot, an identity provider that
already exists is worth more than one that is blocked.

## What to create

In the Google Cloud console, in a project owned by the `campodigital.cl`
organization:

1. **APIs & Services → OAuth consent screen.**
   - User type: **Internal**. This restricts sign-in to `campodigital.cl`
     Workspace accounts at the Google end. It is not the only control — the
     API independently requires the verified `hd` claim to equal
     `campodigital.cl` — but it is the right posture and avoids Google's
     verification review entirely.
   - App name: `Campo Digital — Transelec`.
   - Support email and developer contact: a `campodigital.cl` address.
   - Scopes: **`openid`, `email`, `profile` only.** Nothing else. This
     application reads no Google data: no Drive, no Gmail, no Calendar.

2. **APIs & Services → Credentials → Create credentials → OAuth client ID.**
   - Application type: **Web application** (not "Desktop", not "Android/iOS"
     — the flow runs server-side with a client secret).
   - Name: `Campo Digital Transelec API`.
   - **Authorized redirect URI** — this is the item that cannot be closed
     yet. The value is always the API's public origin plus
     `/auth/google/callback`:
     - `http://localhost:8000/auth/google/callback` — add this now; it is
       needed for local development and is already final.
     - `https://<dominio-definitivo>/auth/google/callback` — **pending the
       domain decision.** It must match byte for byte: scheme, host, port,
       path, no trailing slash. Google rejects the sign-in outright if it
       differs. Once the domain is chosen, add it here and set
       `GOOGLE_REDIRECT_BASE_URL` to the same origin.
   - "Authorized JavaScript origins" is not needed and should be left empty:
     no browser code in this application talks to Google.

3. After creation, return to platform engineering **over a secure channel**
   (not plain email or chat — the second value is a credential):
   - **Client ID** → becomes `GOOGLE_CLIENT_ID`
   - **Client secret** → becomes `GOOGLE_CLIENT_SECRET`

## What platform engineering configures with it

| Variable | Value | Notes |
|---|---|---|
| `GOOGLE_CLIENT_ID` | from step 3 | Not a secret, but must match the registered client. |
| `GOOGLE_CLIENT_SECRET` | from step 3 | Secret. Never in the repository, never in a frontend build. |
| `GOOGLE_REDIRECT_BASE_URL` | the API's public origin | The redirect URI is this + `/auth/google/callback`, and must equal what step 2 registered. |
| `GOOGLE_WORKSPACE_DOMAIN` | `campodigital.cl` | The `hd` claim an `id_token` must carry, exactly, to be accepted. |
| `PLATFORM_TOKEN_ENCRYPTION_KEY` | a generated Fernet key | Encrypts the short-lived sign-in flow cookie. Generate with `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`. |
| `TRANSELEC_BOOTSTRAP_ADMIN_EMAIL` | one `campodigital.cl` address | See "Initial permissions" below. Leave unset to grant nothing automatically. |

## Initial permissions

Signing in does not grant access to anything. A verified `campodigital.cl`
account with no grant for the Transelec product receives a session and then
`403` from every Transelec route.

Access is opened in two steps:

1. **The first administrator.** The single address in
   `TRANSELEC_BOOTSTRAP_ADMIN_EMAIL` receives the `ADMIN` role on
   `transelect` — and on no other product — at its first sign-in, and only
   while it holds no grant at all. It can never grant anything on LiDAR or
   Gestión Predial Forestal. If that account is later demoted, a subsequent
   sign-in does not restore it.

2. **Everyone else** is onboarded by that administrator through the existing
   product-grant endpoints (`app.routers.access_admin`), by email. A grant
   can only be created for someone who has **already signed in at least
   once**: their `app_user` row, and the email it is looked up by, only
   exist from that point on. So the practical order is: each colleague signs
   in once (and sees a `403`), then the administrator grants them the role
   they need — `viewer` for read-only access to the dashboard, `operator` or
   `admin` to import spreadsheets and publish or restore versions.

## What this client will never be used for

- It never signs in as the application itself: there is no service account
  and no client-credentials flow.
- It never reads Google data. No Drive, Gmail, Calendar or directory access
  is requested, and no Google access or refresh token is stored anywhere —
  the token is discarded as soon as the identity token is verified.
- No Google token, client secret or identity token ever reaches the browser.
  The browser gets one `HttpOnly` session cookie issued by this platform.

## Still pending after this handoff

- The public domain, and therefore the exact production redirect URI.
- One real end-to-end sign-in with a `campodigital.cl` account, which is the
  only thing that can confirm the `hd` claim arrives as expected and that
  the bootstrap grant lands on `transelect` alone.

## Related documentation

[Platform documentation](README.md) ·
[Security model](security-model.md) ·
[ADR-010 — Google Workspace sign-in for Transelec](../adr/ADR-010-google-workspace-sign-in-for-transelec.md) ·
[Entra app registration handoff](entra-app-registration-handoff.md)
