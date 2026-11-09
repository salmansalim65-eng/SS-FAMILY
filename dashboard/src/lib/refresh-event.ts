// The top bar's ↻ asks every live panel (calendar, tasks, project cards) to
// reload at once through this window event.
export const REFRESH_EVENT = "dashboard:refresh";

export function requestDashboardRefresh() {
  window.dispatchEvent(new Event(REFRESH_EVENT));
}

/** Runs `fn` whenever the dashboard is refreshed; returns the unsubscribe. */
export function onDashboardRefresh(fn: () => void) {
  window.addEventListener(REFRESH_EVENT, fn);
  return () => window.removeEventListener(REFRESH_EVENT, fn);
}
