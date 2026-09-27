// Per-tab sandbox id (uuid4) per backend/API.md. Replay-time reports are visible only to this session.
let memo: string | null = null;
const KEY = "waterline-session";

export function session() {
  if (memo) return memo;
  try {
    memo = sessionStorage.getItem(KEY);
  } catch {}
  if (!memo) {
    // randomUUID needs a secure context; the getRandomValues form works on plain http too.
    memo =
      crypto.randomUUID?.() ??
      "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (+c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (+c / 4)))).toString(16));
    try {
      sessionStorage.setItem(KEY, memo);
    } catch {}
  }
  return memo;
}
