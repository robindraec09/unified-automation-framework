/** Formats a number the way the UI does: en-AU currency, e.g. -1320.45 -> "-$1,320.45". */
export const toAud = (n: number) =>
  new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(n);
