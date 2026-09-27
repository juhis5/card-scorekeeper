---
name: vercel-deploy
description: How to configure and deploy this app to Vercel — vercel.json, the /api photo-count function runtime, SPA routing, Firebase env vars (public web config vs server-only admin creds), and the last-mile import steps. Read before adding vercel.json, changing build config, or writing deploy docs.
---

# Vercel deploy — Vue app + optional /api function, Firestore for data

Vercel hosts the built Vue app and (if photo-count is built) the `/api` serverless function, from one repo. Firestore is a separate service the client talks to directly — Vercel doesn't proxy it.

## Build config

- Vercel auto-detects the **Vite** preset: build `pnpm build`, output `dist/`. It reads `pnpm-lock.yaml` + the pinned `packageManager` field for the right pnpm.

## vercel.json

SPA fallback for Vue Router without swallowing the API:

```json
{
  "rewrites": [
    { "source": "/((?!api/).*)", "destination": "/index.html" }
  ]
}
```

- If you skip photo-count entirely, there's no `/api`, and a plain SPA rewrite (`/(.*) → /index.html`) is enough.
- It also sets the security headers for every path: a CSP (Report-Only until a preview deploy is clean, see the last-mile steps), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy` and `Permissions-Policy`.

## Function runtime (only if photo-count is built)

- **Node.js runtime** (default) for `/api/count` — it uses the Gemini SDK **and** the Firebase **Admin SDK** to validate the room. The Admin SDK needs Node, not Edge.

## Environment variables

Two very different classes — don't mix them up:

| Name | Class | Where | Notes |
|------|-------|-------|-------|
| `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_*` | **Public** | Client | Firebase web config is public by design; security is Firestore rules. `VITE_` = shipped to browser, that's fine here. |
| `GEMINI_API_KEY` | Secret | Server only | Free-tier, no billing. Never `VITE_`. |
| `GEMINI_MODEL` | Config | Server only | Optional; overrides the default Gemini model when Google renames or retires one. |
| `FIREBASE_SERVICE_ACCOUNT` | Secret | Server only | Admin SDK creds (JSON) for the room-validation check. Never `VITE_`, never in the client. |

- The public/secret split is the thing to get right: web config in `VITE_*`, admin creds + Gemini key server-only.
- Commit `.env.example` with the names. `.env*` gitignored.

## Local dev

- `vercel dev` runs the app + `/api` together (exercises the room-gated Gemini path). `pnpm dev` runs frontend only. Use the **Firebase emulator** for Firestore + rules in local/CI testing (see `tdd`).

## Frontend hosting choice

We host the FE on Vercel (consistency with schedule-app; Firestore is host-agnostic). All-Firebase via Firebase Hosting is the alternative — if you ever switch, `firebase deploy` would do hosting + functions + rules together, and the `/api` function would move to Firebase Cloud Functions.

## Last-mile deploy (human steps)

1. Create the Firebase project; copy the web config into `VITE_FIREBASE_*`. Deploy Firestore rules (`firebase deploy --only firestore:rules`).
2. Push the repo to GitHub.
3. Vercel → Import Project → pick the repo (Vite preset).
4. Add env vars: `VITE_FIREBASE_*` (all), and if photo-count is on, `GEMINI_API_KEY` + `FIREBASE_SERVICE_ACCOUNT` (and `GEMINI_MODEL` only to override the default). Create the Gemini key in a separate Google Cloud project, restricted to the Generative Language API, with no billing.
5. Deploy → live URL. Pushes auto-deploy; PRs get previews.
6. Open a preview deploy with the browser console open and play an online game. `vercel.json` ships the CSP as `Content-Security-Policy-Report-Only`; once no violations show up, rename it to `Content-Security-Policy` (the other security headers are already enforced). `src/security-headers.test.ts` keeps the inline theme script's hash in sync.
7. Before a public launch: consider Firebase App Check (reCAPTCHA Enterprise) for Firestore, Auth and `/api`; anonymous sign-in plus open room creation can otherwise burn the Spark quota. If you add a Firestore TTL on `room.expiresAt`, read the note in DECISIONS first: online stats are keyed by room code.

## Notes

- Run `/security-review` before first real deploy — Firestore rules are the security boundary; also check the key/admin-cred split and the per-room + global rate limits.
- Free-tier limits (Vercel + Firebase Spark) change — verify current pricing before relying on numbers.
