/** The `/room/:code` param for a local game. Never a valid room code, so RoomView can tell a local
 * game apart at mount, before the game store knows. */
export const LOCAL_GAME_ROUTE_CODE = 'local'
