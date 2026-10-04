export class RequestDeadlineError extends Error {
  constructor() { super('REQUEST_TIMEOUT'); this.name = 'RequestDeadlineError'; }
}

/** Bound the complete request, including response body decoding. No retries:
 * a timed-out write may already have committed on the server. */
export async function withRequestDeadline<T>(
  request: (signal: AbortSignal) => Promise<T>, timeoutMs = 20_000,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => { reject(new RequestDeadlineError()); controller.abort(); }, timeoutMs);
      }),
      Promise.resolve().then(() => request(controller.signal)),
    ]);
  } finally { clearTimeout(timer); }
}
