# Contributing

Use Node.js 24–26. Run `npm ci`, then `npm run check` before opening a pull request.
The capture-only preview is available through `npm run build:demo` and `npm run demo`.

Keep changes focused. Add synthetic, in-code examples for behavior changes; do not
add real photographs, live provider responses or runtime databases as fixtures.
Use `docs/architecture.md` for subsystem boundaries. Keep source observations,
provisional identities and user meaning distinct, and preserve correction/undo.

Never enable paid calls in CI. Describe what you tested and any remaining limits.
External model availability and successful builds do not prove visual accuracy.
