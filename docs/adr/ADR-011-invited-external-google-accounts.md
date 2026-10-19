# ADR-011 — Invited external Google accounts

## Status

Accepted 2026-10-19. Implemented and covered by unit and integration tests.
It has not yet been exercised with a real personal Google account: that
depends on the OAuth client's audience (see "Consequences").

Amends `ADR-010-google-workspace-sign-in-for-transelec.md`, point "the `hd`
claim must equal the Workspace domain": that remains the rule for Workspace
members, and the only route to an administrator role.

## Context

Rodales (Gestión Predial Forestal) is used by people outside Campo Digital's
Google Workspace. On 2026-10-19 Javier answered that three personal Google
accounts must sign in to Rodales: one editor (who prepares management
reports) and two viewers. Until then only an id_token whose `hd` claim
equals `campodigital.cl` was accepted, so those accounts could not sign in
at all.

## Decision

1. **Invitation by configuration.** `PLATFORM_EXTERNAL_ACCOUNTS` lists
   `product:role:email` entries. The addresses live in the deployment's
   environment, never in the repository. The value is validated at startup:
   an unknown product, a malformed entry, the same address twice for one
   product, or any role other than `operator` or `viewer` fails the deploy.
2. **Who is admitted.** An id_token without the Workspace `hd` is accepted
   only when its email is verified by Google and equals, whole and
   case-insensitively, an invited address. It is never matched by suffix.
   Everything else is refused as before (`domain_not_allowed`).
3. **What they get.** At first sign-in, the configured role on the
   configured product, once, audited as `product_grant.changed` with
   `via: external_config`. An existing grant is never changed by a later
   sign-in, so an admin's decision stands. Invited accounts never receive a
   bootstrap admin grant, whatever the configuration says.
4. **What an admin can give them.** Through the access API, an account
   outside the Workspace can only be given `operator` or `viewer`, and only
   on a product it is invited to. "Outside the Workspace" means invited, or
   a Google identity whose address is not on the Workspace domain; erring
   that way only restricts.
5. **One Google account per address.** The user is the Google account
   (`sub`) that first signed in with an invited address. A different account
   presenting the same address later is refused
   (`external_identity_mismatch`).
6. **The account chooser.** When any external account is invited, the
   authorization request omits the `hd` hint, or Google would hide personal
   accounts. The hint was never a control; the server-side check is.

## Rationale

Configuration rather than an invitation table: three accounts, one product,
changed rarely, and reviewed by the platform operator. It adds no new
table, no new screen, and no new path by which an administrator could widen
access. A product admin can still lower an invited account's role, or raise
an invited viewer to operator on its own product, through the existing access API.

## Consequences

- **Google-side prerequisite:** the OAuth client's audience must allow
  personal accounts: **External**, and either "In production" or "Testing"
  with these accounts listed as test users. An **Internal** client refuses
  them at Google before this application sees anything
  (`docs/platform/google-workspace-oauth-handoff.md`, "User type").
- **Revocation:** removing an entry blocks the next sign-in. A session
  already open ends within its 8-hour lifetime. The grant row stays, and is
  inert without a session. An admin can also lower it at once.
- `operator` on Rodales includes uploading and publishing new versions of
  the base, not only preparing reports (`app.access`). An invited editor
  holds the same powers as a Workspace operator.
