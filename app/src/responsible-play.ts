import type { PlayerLimits } from './api/client';

type Listener = (limits: PlayerLimits | null) => void;

let current: PlayerLimits | null = null;
const listeners = new Set<Listener>();

/**
 * Keep responsible-play settings in sync across the mounted app.
 *
 * The profile screen and the session clock do not share a navigation parent,
 * so relying on either component to re-fetch leaves freshly changed settings
 * stale until the next sign-in. This tiny in-memory channel only mirrors the
 * server response; the database remains the authority for every bet.
 */
export function publishResponsiblePlay(limits: PlayerLimits | null) {
  current = limits;
  listeners.forEach((listener) => listener(limits));
}

export function responsiblePlaySnapshot() {
  return current;
}

export function subscribeResponsiblePlay(listener: Listener) {
  listeners.add(listener);
  listener(current);
  return () => {
    listeners.delete(listener);
  };
}
