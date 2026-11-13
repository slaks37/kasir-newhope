export const jobMoney = (n: number) =>
  Math.round((n + Number.EPSILON) * 100) / 100;
export interface JobPricing {
  gross: number;
  tax: number;
  service: number;
}
/** Cumulative allocation preserves the quoted tax/service totals across split bills. */
export function jobCheckoutAmounts(
  p: JobPricing,
  subtotal: number,
  billed = { subtotal: 0, tax: 0, service: 0 },
) {
  const cumulative = jobMoney(billed.subtotal + subtotal);
  if (
    !Number.isFinite(subtotal) ||
    subtotal <= 0 ||
    p.gross <= 0 ||
    cumulative > p.gross + 0.001
  )
    throw Error("JOB_QUOTE_OR_QUANTITY_MISMATCH");
  const tax = jobMoney(jobMoney((p.tax * cumulative) / p.gross) - billed.tax),
    service = jobMoney(
      jobMoney((p.service * cumulative) / p.gross) - billed.service,
    );
  return {
    subtotal: jobMoney(subtotal),
    tax,
    service,
    total: jobMoney(subtotal + tax + service),
  };
}
