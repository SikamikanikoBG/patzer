/**
 * Retry a request the server turned away with 429 because it was busy.
 *
 * `/api/analyze/position` is single-flight per user, and Game Review has two
 * panels that call it on the same debounce (Engine Lines and "What's the
 * threat?"), so one of each pair of calls loses the race. Only the threat
 * panel used to retry; Engine Lines treated the 429 as a real failure and
 * stayed empty until the position changed (#89). Both go through this now.
 *
 * Anything other than a 429 is a real answer and is passed straight through.
 * Once `cancelled()` says the caller has moved on (a new position, an
 * unmounted panel) no further attempt is made.
 */
export async function withBusyRetry<T>(
  send: () => Promise<T>,
  cancelled: () => boolean,
  { retries = 4, delayMs = 900 }: { retries?: number; delayMs?: number } = {},
): Promise<T> {
  for (let n = 0; ; n++) {
    try {
      return await send();
    } catch (err) {
      const status = (err as { status?: number } | null)?.status;
      if (status !== 429 || n >= retries || cancelled()) throw err;
      await new Promise((r) => setTimeout(r, delayMs));
      if (cancelled()) throw err;
    }
  }
}
