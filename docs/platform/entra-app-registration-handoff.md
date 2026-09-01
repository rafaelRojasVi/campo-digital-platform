# Entra ID app registration — handoff for Campo Digital tenant admin

## Status

Action required from someone with Global Administrator or Application
Administrator rights in the Campo Digital Microsoft 365 tenant. Platform
engineering cannot perform this step.

## What this is for

The Campo Digital platform (staging, at
`https://campo-digital-portal-staging.onrender.com`, and local development)
needs to let real Campo Digital users sign in with their Microsoft account,
and — only for users who administer file uploads — browse the shared
OneDrive/SharePoint source material described in
`docs/source-systems/onedrive.md`.

## What to create

1. Azure Portal → **Microsoft Entra ID** → **App registrations** → **New
   registration**.
2. Name: `Campo Digital Platform (staging)`.
3. Supported account types: **Accounts in this organizational directory
   only (Campo Digital tenant only — Single tenant)**. Do not choose
   "multitenant" or "personal Microsoft accounts".
4. Redirect URI (platform — Web):
   - `http://localhost:8000/auth/entra/callback` (local development)
   - `https://campo-digital-api-staging.onrender.com/auth/entra/callback`
     (Render staging — confirm this is the API service's actual
     `.onrender.com` hostname per `render.yaml`'s existing caveat before
     entering it)
5. After creation, go to **Certificates & secrets** → **New client
   secret**. Copy the secret **value** immediately (it is shown once).
6. Go to **API permissions** → confirm `Microsoft Graph` →
   `User.Read` (delegated) is present (added by default). Do not add any
   other Graph permission yet — the exact scope is decided later, in
   `docs/source-systems/onedrive.md`, once a discovery step (which needs
   this registration to exist) has run and recorded which OneDrive/SharePoint
   location actually holds Campo Digital's source material.
7. Note down, and return to platform engineering over a secure channel (not
   plain email/chat if avoidable — this is a credential):
   - **Directory (tenant) ID** → becomes `ENTRA_TENANT_ID`
   - **Application (client) ID** → becomes `ENTRA_CLIENT_ID`
   - **Client secret value** from step 5 → becomes `ENTRA_CLIENT_SECRET`

## What happens after this

Platform engineering runs a short, read-only discovery script against a
real sign-in using this registration (no client data is touched — only
Graph metadata calls like "list my drives"). That determines whether a
second permission grant is needed:

- If the source material turns out to live in a SharePoint/Teams document
  library (the most likely case, per `docs/source-systems/onedrive.md`),
  the tenant admin will be asked to run one more one-time action:
  `Sites.Selected` permission grant scoped to exactly one site (not every
  site in the tenant). Platform engineering will provide the exact
  `POST /sites/{site-id}/permissions` request body at that point — do not
  pre-grant broader Graph permissions in anticipation of this.

## What this registration will never be used for

- It is never used to sign in as the app itself (no client-credentials
  flow). Every Graph call uses the signing-in Campo Digital user's own
  delegated permissions.
- It does not grant access to anyone's email, calendar, or Teams data —
  only `openid profile` (sign-in) and, for a small set of upload-capable
  users, read access to the specific OneDrive/SharePoint location
  configured in `config/source-catalog.yaml`.
