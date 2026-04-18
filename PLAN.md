# Linker Mailboard Plan

Date: April 17, 2026

## 1. Goal

Keep Linker as the browser UI and make `gmail-agent` the one shared daemon for mailbox watch, monitor logic, worker logic, and browser-facing mail actions.

`/codex/` is no longer a terminal route. It is now a Cloudflare-gated mailboard for the shared mailbox.

## 2. Current State

Completed in this slice:

- `gmail-agent` now exposes a browser mail API from the daemon process:
  - `GET /api/mail/public-config`
  - `GET /api/mail/health`
  - `GET /api/mail/views`
  - `GET /api/mail/threads?view=...`
  - `GET /api/mail/thread/:threadId`
  - `POST /api/mail/thread/:threadId/read`
  - `POST /api/mail/thread/:threadId/reply`
  - `POST /api/mail/compose`
- Linker `/codex/` now mounts a monochrome mailboard:
  - one Cloudflare Access unlock button
  - one-column mobile layout
  - shared mailbox meta cards
  - thread list
  - message pane
  - in-thread reply
  - new-mail compose panel
  - bottom `3x3` mail pad for `Inbox`, `Needs Reply`, `Waiting`, `Queued`, `Working`, `Done`, `Refresh`, `Compose`, and `Mark Read`
- the old terminal-first smoke is replaced with a browser proof that unlocks, switches views, marks a thread read, replies, and sends a new message
- Linker now has a repo-local live sync probe:
  - `npm run test:codex:mail-sync`
  - checks sibling `gmail-agent` auth state
  - starts the shared daemon if needed
  - calls the live `/api/mail/*` endpoints
  - writes `artifacts/codex-mail-sync-proof.json` when Gmail sync is healthy

## 3. Source Of Truth

Shared daemon:

- `C:\Users\timca\gmail-agent`

Browser UI and static docs:

- `C:\Users\timca\linker`

Ownership split:

- `gmail-agent` owns daemon state, Gmail reads and writes, monitor or worker flow, and the browser mail API
- `linker` owns the web UI, docs routes, browser tests, and static hosting

## 4. Domain Language

Use this language consistently:

- `mailboard`: the `/codex/` mailbox UI in Linker
- `mail view`: the selected mailbox filter on the bottom pad
- `thread row`: one visible thread summary in the list
- `message pane`: the selected thread detail surface
- `compose box`: the reply or new-mail input surface
- `shared daemon`: the one running `gmail-agent` monitor or worker loop
- `shared mail API`: the HTTP surface exposed by `gmail-agent`

## 5. Verification

Green now:

- `cd C:\Users\timca\gmail-agent && npm test`
- `cd C:\Users\timca\linker && npm run lint`
- `cd C:\Users\timca\linker && npm run build`
- `cd C:\Users\timca\linker && npm run test:browser:codex`

Current live blocker on this machine:

- `npm run test:codex:mail-sync` is wired and working, but it currently stops on revoked or missing Gmail daemon scopes
- the next operator step is:
  - `cd C:\Users\timca\gmail-agent`
  - `npm run auth:reset:daemon`
  - finish the Google consent flow in the browser
  - rerun `cd C:\Users\timca\linker && npm run test:codex:mail-sync`

## 6. Next Slices

### Slice A: Live Cloudflare Publish

Goal:

- point the live public mail origin at the shared `gmail-agent` daemon
- verify GitHub Pages `/codex/` against the real hosted origin

Work:

- restore or recreate the Cloudflare-published origin at `https://mail.example.com`
- verify `GET /api/mail/public-config` and `GET /api/mail/health` from the GitHub Pages origin
- run a live `/codex/` review after publish

### Slice B: Mailboard View Expansion

Goal:

- widen the browser mailbox vocabulary without breaking the `3x3` pad discipline

Work:

- add pad pages or a menu flow for `alert`, `receipt`, `newsletter`, `personal`, `review`, `error`, and `blocked`
- add thread-level quick actions only if they still fit the grid model cleanly

### Slice C: Repo Cleanup

Goal:

- remove stale terminal-bridge code and scripts from Linker once the live shared-daemon path is confirmed

Work:

- delete the unused terminal-first `/codex/` files
- remove legacy bridge scripts and tests that are no longer part of the product path
- keep README and the code index aligned with the cleaned tree

