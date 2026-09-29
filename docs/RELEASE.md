# Releasing to production

`main` deploys to rommi.vercel.app on the production Firebase project
`card-scorekeeper-prod-1673f`. A release fast-forwards `main` to `develop`. The steps depend on
each other, so run them in this order. Only the owner says "release".

## 1. Before anything goes out

- `develop`'s latest push run is green (verify, rules, e2e, visual), not only its PR checks.
- Staging smoke test on test-rommi.vercel.app with two real phones, including an iPhone as host:
  create a room, join it by code and by the invite QR, play five rounds, finish, and check that
  the game shows on Tilastot and Ennätykset. End one more game early from the menu.
- Vercel, Production scope: `VITE_SENTRY_DSN` and `SENTRY_AUTH_TOKEN` are set (not only
  Preview), and `GEMINI_API_KEY` is a key on a billed Google Cloud project with a budget alert and
  a hard quota cap (the Gemini API terms allow only paid services for EEA users).
- Production Firebase console: Anonymous and Google sign-in are enabled; `rommi.vercel.app` is an
  authorized domain; the web API key's HTTP-referrer restrictions (if any) include it. Vercel's
  preview URLs aren't authorized domains, so Google sign-in works only on the two named sites.

## 2. Rules and indexes first

```sh
pnpm exec firebase deploy --only firestore:rules,firestore:indexes --project card-scorekeeper-prod-1673f
pnpm exec firebase firestore:indexes --project card-scorekeeper-prod-1673f
```

Wait until the Firebase console shows every composite index as **Enabled** (minutes): the new
app's Ennätykset queries fail until then. Rules go before the app because the app published
today (the old `main`) writes shapes the new rules still accept, while the new app needs the new
rules and indexes.

## 3. Backfill the public lists

Games played in production before this release have stats rows but no leaderboard entries or
player totals. Run the backfill now, between the rules and the app: the app still live (the old
`main`) never publishes, so nothing races it.

```sh
gcloud auth application-default login          # once; or GOOGLE_APPLICATION_CREDENTIALS
pnpm backfill:highscores --project card-scorekeeper-staging                 # dry run first
pnpm backfill:highscores --project card-scorekeeper-prod-1673f              # read the plan
pnpm backfill:highscores --project card-scorekeeper-prod-1673f --write      # apply it
```

It applies the rules' conditions itself (the Admin SDK bypasses them): only games whose room
exists, is `finished` and has at least two participants. It creates missing entries and
**rebuilds** each affected player's totals from all their counted games, so a rerun changes
nothing. The planner is `src/lib/game/highscore-backfill.ts` (unit-tested).

## 4. The app

```sh
git fetch origin
git merge-base --is-ancestor origin/main origin/develop && git push origin origin/develop:main
```

Vercel builds `main` in about a minute. Installed apps keep their old version until the player
taps the update banner (or Päivitä sovellus in the menu); the old version keeps working
against the new rules.

## 5. Check production

- rommi.vercel.app loads, and a new game can be started.
- Ennätykset shows the backfilled games.
- Sentry shows events with environment `production` and readable (symbolicated) stack traces.

## Rolling back

- The app: Vercel's instant rollback to the previous production deployment.
- The rules: redeploy them from the previous `main` commit. They don't roll back with the app.
- Data written under the new rules stays. The old app never reads the leaderboard or player
  totals. It doesn't know the `abandoned` status: it treats such a room as still going (only
  `finished` ends a game there).

## After the release

- Switch the CSP from Report-Only to enforcing, once a Report-Only period shows no violations
  on phones (add a report endpoint first). The CSP allows Google sign-in's script
  (`apis.google.com`) and each project's `*.firebaseapp.com` auth frame; check those against real
  reports on both sites before enforcing.
- Remove the permission-denied fallback in `FirestoreGameRepository.isSeated`, which only
  covered the rules production ran before this release.
- Decide on App Check (see docs/DECISIONS.md, 2026-09-28).
