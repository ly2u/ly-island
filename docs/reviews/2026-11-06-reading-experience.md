# Island reading transitions and deployment source reconciliation

Scope: the existing VPS application on `main`. The separate `framework`
prototype, Civil executor, credentials and content stores are unchanged.

## Visible behavior

At viewport widths of 1100px and above, opening a building moves the camera
towards that building over 420ms. A paper reading space opens alongside it,
leaving at least 336px of the scene visible. The camera retains the visitor's
original orbit, target and zoom until they return to the island. Switching
rooms or interrupting a return does not overwrite that original position.
Search returns to the general island view. No building or saved coordinate moves.

Smaller viewports keep the original reading layout and camera. Changing window
size while reading updates the framing; the small-screen layout restores the
original camera immediately. Reduced-motion preferences remove the camera tween.
The existing reading preference still avoids downloading the 3D module at all.

Implementation: `apps/ly-island-preview/src/scene-focus.js`, `scene.js`,
`main.js` and `rooms.css`. The reading-panel width and camera framing share the
same breakpoint, 1040px maximum paper width and 24px outer margin.

## Source parity for the existing host

The release gate correctly rejected the previous performance release because
the live Caddy and Compose configuration differed from Git. This change records
the existing configuration byte for byte: the patched local Caddy image, its
build recipe, the external SecWatch network and its reverse-proxy route.
The website Dockerfile also retains the Node 24.22.1 image digest already pinned
on the host. These are existing host settings, not newly deployed services.

Only the Caddy Dockerfile and a new explanatory README are imported from the
security-update directory. Old configuration snapshots, scan reports, environment
files, certificates and runtime data are not imported. Configuration drift still
blocks deployment. The release process continues to manage only sites and island
assets; it does not recreate Caddy, CivilFlow or SecWatch.

## Validation

- Node 24.22.1: nine scene tests, including interrupted camera restoration,
  viewport projection, reduced motion and idle completion; Vite production build.
- All website `scripts/check*.mjs` checks in an isolated directory without `.env`.
- Release simulation: 18 groups; mailbox backup: 7; MFA backup: 9;
  portable backup: 10. No production writes or model calls.
- Offline Chromium with synthetic island/content fixtures: all five building
  spaces at 1280, 1100, 390 and 320px; full article rendering; Escape and browser
  back; exact camera restoration; rapid room changes; resize 1280 to 390 to 1600;
  reduced motion; direct article links; reading mode without a scene download.
- Separate pointer-driven checks move the library, mailbox and a tree at desktop
  and phone widths, and verify paths plus paused/hidden rendering.
- Compose syntax checked with synthetic environment files. Caddy validated in a
  separate network-disabled container using synthetic credentials, without
  mounting production certificates. Candidate Caddy/Compose bytes match the
  current host; no running proxy reload is required.

Screenshots and browser diagnostics use synthetic content and remain outside
the repository. Chromium uses a software renderer: this verifies behavior and
layout, not real phone GPU performance. Live release results belong in the
host's `DEPLOYMENT-STATUS.md` after publication, not in this pre-release report.
