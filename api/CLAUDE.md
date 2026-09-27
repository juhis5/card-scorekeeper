# api/

One Vercel function, `count.ts`: photo card-count with Gemini. Optional; manual scoring never depends on it.

- Every file directly in `api/` becomes a function, so helpers live in `api/_lib/` and nothing else goes at the top level.
- Runs as native Node ESM: relative imports (including the `src/lib/game/*` files it uses) end in `.js`. `tsconfig.api.json` enforces it; `pnpm test:api-load` proves it loads.
- The Gemini key and Firebase service account are server-only env vars. Requests are gated by room + ID token and rate-limited; the card total is always recomputed with `src/lib/game/rules.ts`, never trusted from the model.
- Tests: `pnpm test:api` (SDKs mocked).
