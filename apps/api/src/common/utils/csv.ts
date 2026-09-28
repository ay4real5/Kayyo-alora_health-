/**
 * CSV writing for downloads (reports, payroll). RFC 4180 quoting, CRLF line ends, and protection against spreadsheet
 * formula injection (OWASP "CSV injection", DECISIONS D-068): a text cell starting with = + - @, tab or carriage return
 * is prefixed with an apostrophe so Excel/Sheets show it as text instead of running it. Numbers — including numeric
 * strings such as "-5.00" — are left exactly as they are.
 */

const FORMULA_START = /^[=+\-@\t\r]/;
const NUMERIC = /^-?\d+(\.\d+)?$/;

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text =
    value instanceof Date
      ? value.toISOString()
      : typeof value === 'object'
        ? JSON.stringify(value)
        : String(value as string | number | boolean);
  if (typeof value !== 'number' && FORMULA_START.test(text) && !NUMERIC.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** Rows (the first is usually the header) → CSV text ending in CRLF. */
export function csvRows(rows: unknown[][]): string {
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
