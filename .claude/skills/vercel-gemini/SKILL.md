---
name: vercel-gemini
description: How to write the serverless function that hides the Gemini key and reads a photo of leftover cards into a card list + total, gated by room code + session token (not a shared passphrase) with per-room and global rate limits. Read before creating or editing the photo-count function or wiring the frontend to it. Optional feature — manual scoring needs none of this.
---

# Serverless function — Gemini card-count (room-gated)

Optional shortcut for the "snap your leftover cards" feature. Manual scoring is the primary path and needs **no** key, no function — this whole skill applies only if photo-count is being built.

The function is the **only** place the Gemini key exists. It can run on Firebase Cloud Functions or a Vercel/Netlify function (same account as the frontend host). The browser never sees the key.

## Why not a shared passphrase (the wrinkle vs schedule-app)

The card game is joined by strangers via a room code, and any player can snap a photo. You can't hand a fixed secret to people you don't know. **The gate is the room itself.**

## Contract

- **Method**: `POST` only (else 405).
- **Request** (JSON): `{ roomCode: string, sessionToken: string, image: string /* base64 */, mimeType: string }`.
- **Response** (JSON): the extraction shape from docs/PLAN.md:
  ```json
  { "cards": [ {"rank":"4","suit":"diamonds","value":4}, {"rank":"Joker","suit":null,"value":25} ],
    "total": 54 }
  ```
- The result is a **suggestion**. The UI shows the card list + total and the player confirms or edits before it commits to `round_score`. Never auto-commit a photo total.

## Layered gate (cheapest checks first)

1. **Room-validated call.** Using the **Firebase Admin SDK** server-side, verify: the room exists, is an active game (not finished/expired), and the `sessionToken` matches a player issued into that room on join. Any of these fail → 403. Random pokes with no valid room are rejected. (Admin SDK bypasses Firestore rules — keep its service-account creds in the function env only.)
2. **Per-room rate limit.** Cap calls per room (a hand-count a few times per round is plenty). One abusive room can't drain the quota. Exceed → 429.
3. **Global rate limit.** A ceiling across all rooms so nobody spins up many fake rooms to beat the per-room cap. Use Vercel KV / Upstash (in-memory won't span instances or cold starts).
4. **Short-lived rooms.** Rooms expire after a game or a few hours, so a leaked code stops working — the gate is naturally temporary.
5. **Free-tier key, no billing.** The hard ceiling is the safety net: worst case "quota exhausted today", never a surprise invoice.

This is *good enough for a friends' game*, not airtight — a real player could still burn some calls. The caps bound the damage and it self-heals (rooms expire, quota resets daily). Real per-user auth would be overkill for the stakes.

## Env vars (function env only, never in the repo)

- `GEMINI_API_KEY` — free-tier, **no billing attached**.
- `FIREBASE_SERVICE_ACCOUNT` (or the discrete admin creds) — for the Admin SDK room check.
- (rate limit) `KV_REST_API_URL`, `KV_REST_API_TOKEN`.

Ship a `.env.example` with names only. `.env*` is gitignored.

## Gemini call — force structured output

Current Gemini Flash model (e.g. `gemini-2.5-flash` — verify current name/pricing). Constrain output with a response schema matching the extraction shape, `temperature: 0`. Encode the Rommi card values in the prompt:

- number cards = face value (2–10), J/Q/K = 10, **Ace = 15**, **Joker = 25**.
- Return one entry per detected card with `rank`, `suit` (null for Joker), `value`, plus the summed `total`.
- Cards laid flat and non-overlapping read far better than a fan — the UI should tell players this.

## Response handling & accuracy

- Validate the model output against the schema before returning; recompute `total` server-side from the card list so a bad sum can't slip through.
- Counting cards from a photo is harder than reading text (overlap, glare, half-hidden cards). Treat every result as needing a glance — the card-by-card breakdown + confirm/edit step in the UI exists for exactly this. Manual typing stays right next to it as the always-works fallback.
- On Gemini/quota error, return a clean error status so the UI falls back to manual entry.

## Security reminders

- Never log the image, tokens, or keys. Key + admin creds only in the function env, only server-side.
- If a secret ever appears in `src/` or a `VITE_` var, that's a bug — move it here.
