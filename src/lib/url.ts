/** This page's path for a room (or none): `?room=CODE`, else the bare path. */
export function appUrl(room?: string): string {
  return room ? `${location.pathname}?room=${encodeURIComponent(room)}` : location.pathname
}
