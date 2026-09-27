---
name: vercel-gemini
description: How to write the serverless function that hides the Gemini key and reads a photo of leftover cards into a card list + total, gated by room membership via the caller's Firebase ID token (not a shared passphrase) with per-room and global rate limits. Read before creating or editing the photo-count function or wiring the frontend to it. Optional feature — manual scoring needs none of this.
---

# Serverless function — Gemini card-count (room-gated)

Optional shortcut for the "snap your leftover cards" feature. Manual scoring is the primary path and needs **no** key, no function — this whole skill applies only if photo-count is being built.

The function is the **only** place the Gemini key exists. It's a **Vercel serverless function** (`/api`, same repo + host as the frontend — no separate backend repo), matching schedule-app's pattern. The browser never sees the key.

## Why not a shared passphrase (the wrinkle vs schedule-app)

The card game is joined by strangers via a room code, and any player can snap a photo. You can't hand a fixed secret to people you don't know. **The gate is the room itself.**

## Contract

- **Method**: `POST` only (else 405).
- **Auth**: `Authorization: Bearer <Firebase ID token>` — the caller's anonymous-auth ID token (`user.getIdToken()`). No separate session token: the uid is what player docs are keyed by, so the Admin SDK can check membership directly (see DECISIONS, "photo-count ID-token gate").
- **Request** (JSON): `{ roomCode: string, image: string /* base64 */, mimeType: string }`. `roomCode` must pass `isValidRoomCode`; `mimeType` is jpeg/png/webp/heic/heif; `image` must be real base64.
- **Response** (JSON): the extraction shape from docs/PLAN.md:
  ```json
  { "cards": [ {"rank":"4","suit":"diamonds","value":5}, {"rank":"Joker","suit":null,"value":25} ],
    "total": 55 }
  ```
- The result is a **suggestion**. The UI shows the card list + total and the player confirms or edits before it commits to `round_score`. Never auto-commit a photo total.

## Layered gate (cheapest checks first) — `api/_lib/handler.ts`

| Step | Check | Fail |
|---|---|---|
| 1 | method, body shape, room-code format, mime type, base64 | 405 / 400 |
| 2 | image size cap (before any I/O) | 413 |
| 3 | ID token verified with `jose` in `id-token.ts` (Firebase's documented checks; `auth/*` errors only, anything else is a server fault → 500) | 401 |
| 4 | room exists, not finished/expired, caller has a seat | 403 |
| 5 | per-room (30 / 15 min), then global (300 / h) rate limit | 429 |
| 6 | Gemini call: timeout → 504, quota/429 → 503, anything else → 502 | 504 / 503 / 502 |
| 7 | model output fails validation | 422 |

The client (`usePhotoCount`) maps each status to a reason, and `PhotoCountSheet` shows a message per reason with "Try again" only where a retry can help (not for 401/403/500).

- **Rate limits are in memory, per function instance** (`InMemoryRateLimitStore`). Owner accepted this for a friends' game (DECISIONS, round 5): cold starts and parallel instances each get a fresh budget, so the real ceiling is Gemini's own free-tier quota. If abuse shows up, swap in an Upstash/Redis `RateLimitStore`; the interface already exists.
- **Short-lived rooms.** Rooms expire after ≤7 h, so a leaked code stops working.
- **Free-tier key, no billing.** Worst case is "quota exhausted today", never an invoice.

Good enough for a friends' game, not airtight: a seated player can still burn calls. The caps bound it and it self-heals.

## Env vars (function env only, never in the repo)

- `GEMINI_API_KEY` — free tier, **no billing attached**. Create it in a Google Cloud project **separate from the Firebase project**, and restrict it to the Generative Language API. Never reuse the Firebase browser key: that one is public by design.
- `GEMINI_MODEL` — optional; overrides `DEFAULT_GEMINI_MODEL` (`gemini-3.8-flash`) when Google retires or renames models. No code change, but Vercel only applies env changes to new deployments, so redeploy.
- `FIREBASE_SERVICE_ACCOUNT` — single-line service-account JSON for the Admin SDK (token verify + room read).

`.env.example` lists the names. `.env*` is gitignored.

## Gemini call — `api/_lib/gemini.ts`

- `@google/genai`, model from `GEMINI_MODEL` (default above). Structured output: `responseMimeType: 'application/json'` + a `responseSchema` matching the extraction shape, `cards` capped at `MAX_DETECTED_CARDS` (60).
- `thinkingConfig: { thinkingLevel: LOW }` and `maxOutputTokens` keep latency and cost bounded. Leave temperature at its default (Gemini 3 guidance).
- `abortSignal: AbortSignal.timeout(15 s)`; `vercel.json` gives the function `maxDuration: 30`, and the client gives up at 20 s.
- Rommi card values go in the prompt: 2–9 = 5, 10 = 10, J/Q/K = 10, **Ace = 15**, **Joker = 25**.
- The game uses **2 (sometimes 3) decks**, so identical cards (same rank + suit) and several Jokers are normal. Tell the model to list every physical card and never merge look-alikes; never dedupe copies server-side.
- Cards laid flat and non-overlapping read far better than a fan — the UI tells players this.

## Response handling & accuracy

- Validate the model output (`parseModelOutput`) and recompute every value and the total with `rules.ts` — the model's own numbers are never trusted.
- Counting cards from a photo is harder than reading text (overlap, glare, half-hidden cards). Every result needs a glance — hence the card-by-card breakdown + confirm/edit step. Manual typing stays right next to it.
- Log failures with `logServerError(stage, error)`: error name + message only.

## ESM on Vercel — explicit `.js` imports

The repo is `"type": "module"`, and Vercel runs `api/` as native Node ESM. Every relative import in `api/`, **and in any `src/lib` file `api/` imports** (`rules.ts`, `types.ts`, `room-code.ts`), must end in `.js`. `tsconfig.api.json` (`module: nodenext`) enforces it at typecheck, and `pnpm test:api-load` (in CI) compiles `api/` and imports it in plain Node to prove it loads.

Vercel's function loader also refuses `require()` of an ESM-only package, which Node 24 otherwise allows. That's why `firebase-admin/auth` is never imported: it loads `jwks-rsa`, which `require()`s `jose` v6. `test:api-load` runs with `--no-experimental-require-module` to catch this. To test Vercel's own function build locally, run `pnpm dlx vercel build --prod --yes` (it needs a `.vercel/project.json`, not a login) and import `.vercel/output/functions/api/count.func/api/count.js` with the same flag.

## Downscale the image in the browser before upload

A raw phone photo is 5–12 MB → slow uploads on mobile data, possible payload-limit rejections at the function, and wasted Gemini tokens/quota. **Resize + compress client-side before the `/api` call.**

- Draw to a `<canvas>` (or `createImageBitmap` + `OffscreenCanvas`) at **~1600px on the long edge**, export JPEG at **quality ~0.8**, then base64. Target well under ~1.5 MB.
- **Respect EXIF orientation** (iOS photos rotate) — `createImageBitmap(file, { imageOrientation: 'from-image' })`.
- 1600px is plenty to read cards laid flat and non-overlapping; bigger just costs tokens.
- Keep it a testable composable (`useImageDownscale`), pure-ish (in → out), unit-tested (see `tdd`).
- Server-side size cap stays as defence-in-depth (the 413 check) — client downscale is the optimisation, not the trust boundary.

## Security reminders

- Never log the image, tokens, or keys. Key + admin creds only in the function env, only server-side.
- If a secret ever appears in `src/` or a `VITE_` var, that's a bug — move it here.
