# Security policy

## Reporting a vulnerability

Email humanness-index@vapi.ai with the details. Include reproduction steps
and the impact you believe the issue has. We will acknowledge within three
business days.

Please do not open public issues for security reports, and please do not
test against the production site in ways that degrade it for voters
(vote-stuffing probes included).

## Scope notes

- The vote API's shape is public by design. Abuse resistance comes from
  single-use HMAC battle tokens, per-IP rate limiting, and a Turnstile
  challenge cadence. Reports that meaningfully bypass those layers are in
  scope and appreciated.
- Standings are not security-critical data, but vote integrity is the
  product. Treat anything that lets one actor silently shift standings at
  scale as in scope.
- Secrets never live in this repository. If you find one anyway, report it
  immediately.
