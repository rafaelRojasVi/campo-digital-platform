# ADR-008 — Google Workspace sign-in for the platform

## Status

Accepted (2026-09-25). Replaces the Microsoft Entra ID direction recorded as
"worth evaluating" in `../platform/security-model.md` and prepared in
`../platform/entra-app-registration-handoff.md`. Leaves
[ADR-006](ADR-006-restrict-dev-auth-to-development.md) unchanged: dev-login
stays development-only.

## Context

- **FACT** — No Campo Digital Microsoft Entra tenant exists
  (`../platform/entra-app-registration-handoff.md`), so Entra sign-in has
  been externally blocked since 2026-09-01.
- **FACT** — Campo Digital operates Google Workspace on `campodigital.cl`.
- **FACT** — The stakeholder decision (2026-09-25) is to sign in with Google
  Workspace, restricted to `@campodigital.cl`, and to disregard the
  Microsoft Entra app registration.
- **FACT** — Main already has the durable pieces a real identity needs: the
  hashed-secret `platform.session` store (`app.session_store`), the
  `platform.app_user` identity map keyed by `(identity_kind, identity_key)`,
  and product-scoped RBAC through `platform.product_grant` and
  `app.deps.ensure_can`.
- **FACT** — Before this change, `GET /auth/me` and `POST /auth/logout` were
  mounted only with the development-only dev-auth router, so no hosted
  environment could inspect or end a real session.

The implementation is ported from the Google slice of the unmerged branch
`feat/transelec-ux-rearchitecture-v1` (commit `0c45b38`), without that
branch's Entra, CSRF, access-admin or Transelec dashboard work.

## Decision

1. **Provider.** Google OpenID Connect, authorization code flow with PKCE
   (S256), server-side with a client secret. Scopes `openid email profile`
   only. No Google access or refresh token is stored.
2. **Verification is explicit** (`app.google_auth.verify_id_token`): RS256
   signature against Google's published JWKS with the algorithm pinned, then
   `iss` (exactly `https://accounts.google.com` or `accounts.google.com`),
   `aud` (the configured client ID), `exp`, `iat`, `sub`, the `nonce` this
   flow issued, `email_verified is True`, and `hd` equal to
   `GOOGLE_WORKSPACE_DOMAIN` (default `campodigital.cl`), compared as a whole
   domain, never as an email suffix. Any failure, including an unreachable
   key set, rejects the sign-in.
3. **Identity key.** A user is `identity_kind = "google"`,
   `identity_key = <Google sub>`. The email is recorded on first sign-in but
   is not the identity: a renamed account keeps its user row and grants.
4. **Sessions.** A successful callback creates a normal `platform.session`
   row and sets the existing `campo_session` HttpOnly, SameSite=Lax cookie
   (Secure outside development). The login flow state (state, nonce, PKCE
   verifier) round-trips in a 10-minute, Fernet-encrypted HttpOnly cookie
   keyed by `PLATFORM_TOKEN_ENCRYPTION_KEY`, so it survives multiple API
   replicas.
5. **Authentication is not authorization.** Signing in grants nothing. A
   verified `campodigital.cl` account without a `product_grant` receives a
   session and then `403` from every product route.
6. **Bootstrap is explicit configuration.** `PLATFORM_BOOTSTRAP_ADMIN_EMAIL`
   plus `PLATFORM_BOOTSTRAP_ADMIN_PRODUCTS` (comma-separated subset of
   `lidar`, `forestry`, `transelect`, validated at settings load) grant
   ADMIN on exactly those products, once, to that exact address (case-
   insensitive, whole-address), and only while the user holds no grant at
   all. Each such grant is audited as `access.bootstrap_admin_granted`.
   Nothing is hardcoded; with either variable unset nothing is granted.
7. **Session routes everywhere.** `/auth/me` and `/auth/logout` move to
   `app.routers.session` and are mounted in every `APP_ENV`, alongside
   `/auth/google/login` and `/auth/google/callback`. Unconfigured Google
   credentials answer `503`, not `404` or `500`.
8. **Production fails closed.** Under `APP_ENV=production`, startup
   (`app.identity_safety`) requires `GOOGLE_CLIENT_ID`,
   `GOOGLE_CLIENT_SECRET`, a valid Fernet `PLATFORM_TOKEN_ENCRYPTION_KEY`, an
   `https://` `GOOGLE_REDIRECT_BASE_URL`, and the bootstrap pair set together
   or not at all. Other environments start without them.

## Rationale

- An identity provider Campo Digital already operates beats one that does
  not exist.
- `hd` is the only Workspace-membership signal Google signs into the token;
  an address that merely ends in `@campodigital.cl` proves nothing, and the
  `hd` request parameter is only a hint Google does not enforce.
- `sub` is stable across renames; email is not.
- Verifying the token in this code, with each rejected case tested against
  locally signed RS256 tokens, makes the security checks reviewable rather
  than hidden in a library default.

## Consequences

- The OAuth redirect URI is `GOOGLE_REDIRECT_BASE_URL` +
  `/auth/google/callback`. Because the portal reaches the API through a
  same-origin `/api/*` proxy, the base must be the **portal** origin plus
  `/api` for the session cookie to be first-party to the portal.
- No grant-management endpoint exists on main yet: beyond the bootstrap,
  grants are created directly in `platform.product_grant`. A product-grant
  onboarding API remains follow-up work.
- `/auth/logout` is a cookie-authenticated POST without a CSRF token; the
  SameSite=Lax session cookie is not sent on cross-site POSTs. Shared CSRF
  protection remains follow-up work.
- The Entra settings and `maybe_grant_bootstrap_admin` remain in code but
  are unused by any sign-in route.
- **LIMITATION** — No real Google sign-in has run. Tests use locally signed
  tokens and a fake provider. One end-to-end sign-in with a real
  `campodigital.cl` account is still required to confirm the `hd` claim
  arrives as expected.

## Related documentation

[Google Workspace OAuth handoff](../platform/google-workspace-oauth-handoff.md) ·
[Security model](../platform/security-model.md) ·
[ADR-006 — Restrict dev-auth to development](ADR-006-restrict-dev-auth-to-development.md)
