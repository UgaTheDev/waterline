// The replay event every API call is scoped to (backend: GET /events). Empty means the backend's default (Harvey).
let current: string | null = null;

export function currentEvent(): string {
  if (current === null) {
    try {
      current = sessionStorage.getItem("wl-event") ?? "";
    } catch {
      current = "";
    }
  }
  return current;
}

export function setEvent(id: string) {
  current = id;
  try {
    sessionStorage.setItem("wl-event", id);
  } catch {}
}
