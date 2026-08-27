# Security Policy

## Supported code

Security fixes are applied to the current `main` branch. Historical commits are
not maintained as separate supported release lines unless a future release
policy explicitly states otherwise.

## Reporting a vulnerability

Do not publish credentials, private client data, exploit details, or other
sensitive evidence in a public issue.

Report suspected security problems to the repository owner through a private
channel. Include only the minimum information necessary to reproduce and assess
the issue.

If a credential may have been exposed, treat it as compromised immediately:
rotate or revoke it first, then assess repository history, logs, generated
artifacts, and downstream systems as necessary.

## Scope

Relevant reports include:

- exposed credentials or tokens;
- unauthorized access to application, database, object, or source-system data;
- accidental disclosure of private client or geospatial data;
- dependency or supply-chain vulnerabilities with practical impact;
- authorization bypasses;
- insecure handling of generated artifacts;
- weaknesses that violate the platform security model.

Secret scanning and dependency vulnerability checks are automated in CI, but
automated scanning does not replace responsible security review.
