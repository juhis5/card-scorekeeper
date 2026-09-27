/**
 * The `/room/:code` route param value that means "this is a local, single-device game" rather
 * than a real Firestore room code (see `lib/game-mode.ts`'s host/join split and RoomView's
 * resume-on-reload). `GameSetup.vue` writes this when routing an offline-fallback host to the
 * room screen; `RoomView.vue` reads it to decide whether a reload is even allowed to resume a
 * persisted LOCAL game — an online room's code is never this value, by construction (see
 * `room-code.ts`'s alphabet/length), so it also doubles as a safe "is this a local game" check
 * without asking the game store, which doesn't know yet at mount time.
 */
export const LOCAL_GAME_ROUTE_CODE = 'local'
