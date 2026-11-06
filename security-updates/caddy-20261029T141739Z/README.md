# Existing Caddy security image

This recipe records the image already used on the VPS since 2026-10-29.
Compose references `ly-caddy:security-20261029-1` with `pull_policy: never`.
The official Caddy base is pinned by digest; Alpine packages were upgraded at
build time. Rebuilding later can select newer Alpine packages, so retain the
previous image ID for rollback and record the new one before replacing it.

This source reconciliation does not rebuild or restart Caddy. The external
`secwatch-edge` network and `sec.ly2u.com` route are existing configuration;
SecWatch itself is managed separately. A new host needs that network and its
service, or an explicitly reviewed host-specific configuration.

No environment files, certificates, vulnerability reports or runtime data are
included here. Production `compose.yaml` and `Caddyfile` must still match the
release exactly; the release script continues to reject configuration drift.
