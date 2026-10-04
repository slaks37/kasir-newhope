/** Retry only startup connection probes, never a business/financial mutation. */
export async function waitForDatabase(
  probe: () => Promise<void>,
  vercel = process.env.VERCEL,
  sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)),
): Promise<void> {
  // A serverless request must return an error rather than wait through a local
  // orchestrator's startup budget. pg's connection timeout bounds each probe.
  const attempts = vercel === '1' ? 1 : 15;
  let cause: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try { await probe(); return; }
    catch (error) { cause = error; }
    if (attempt + 1 < attempts) await sleep(Math.min(250 * 2 ** attempt, 3000));
  }
  throw Object.assign(new Error(`Database tidak bisa dihubungi setelah ${attempts} percobaan`), {cause});
}
