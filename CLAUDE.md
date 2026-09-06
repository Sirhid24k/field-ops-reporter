@AGENTS.md

## Branch policy

- All work happens on the `dev` branch. Commit and push to `dev` only.
- Never commit directly to `master`.
- `master` is updated only by merging `dev` after the session 6 security review passes. That merge triggers the production build on Vercel.
- Pushes to `dev` build as Vercel Previews; that is where phone testing happens.
