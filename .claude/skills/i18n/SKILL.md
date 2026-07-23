---
name: i18n
description: Internationalization with vue-i18n — all user-facing strings via keys (no hardcoded text), locale files, typed messages, Intl date/number/time formatting, locale persistence, <html lang>. Read before adding any user-facing text or formatting a date/number/time. Enforce from day one — retrofitting is expensive.
---

# i18n — vue-i18n, enforced from day one

Enforcing i18n from the start is far cheaper than retrofitting. Stack: **vue-i18n** (Composition API, `legacy: false`). Install latest stable: `pnpm add vue-i18n`.

## Rules

- **No hardcoded user-facing strings.** Every label / message / button / error goes through a key: `t('room.join')`. Enforced in `review-checklist`.
- Locale files in `src/locales/` (`en.json`, `fi.json`), namespaced by feature/view.
- **Typed messages**: message schema so missing/renamed keys are type errors + autocomplete.
- **Interpolation + pluralization via i18n**, never string concatenation: `t('players.count', n)`.
- **Numbers / dates via Intl** (`n()` / `d()`) — never hand-format.
- Set `<html lang>` to the active locale (a11y — see `a11y-mobile`).
- Persist the chosen locale (localStorage / the identity store, like the theme); switcher beside the theme toggle.
- Lazy-load locale messages only if they grow large.

## Setup sketch

```ts
import { createI18n } from 'vue-i18n'
const stored = localStorage.getItem('locale')
export const i18n = createI18n({
  legacy: false,
  locale: stored ?? (navigator.language.startsWith('fi') ? 'fi' : 'en'),
  fallbackLocale: 'en',
  messages: { en, fi },
})
```

## Testing

- A test that every locale has the same key set (catches missing keys). Render a component under a locale and assert translated text (see `tdd`).

## This project (card-scorekeeper)

`fi` + `en`. Default to the device language (`navigator.language`), `en` fallback; the switcher persists a choice. Rommi terms + the five contract descriptions live in locale files (display-only reminders — the rules themselves stay in `lib/rules.ts`). Scores/counts via Intl `n()`.
