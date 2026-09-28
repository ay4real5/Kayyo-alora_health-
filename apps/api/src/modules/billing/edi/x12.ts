/**
 * Minimal X12 building blocks (DECISIONS D-053): separators, element sanitising, fixed-width ISA fields, dates.
 * Separators: `*` element, `:` component, `^` repetition, `~` segment terminator (one segment per line for
 * readability — clearinghouses accept the trailing newline).
 */

export const ELEMENT = '*';
export const COMPONENT = ':';
export const REPETITION = '^';
export const TERMINATOR = '~';

/**
 * Makes a value safe for an X12 element: upper-case, only the basic character set, no separators, no leading or
 * trailing spaces. Names with accents lose them (X12 5010 basic set).
 */
export function clean(value: string | number | null | undefined, max?: number): string {
  if (value === null || value === undefined) return '';
  const text = String(value)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[*:^~\r\n]/g, ' ')
    .replace(/[^A-Z0-9 !"&'()+,\-./;?=%@[\]_{}\\|<>#$]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return max ? text.slice(0, max).trim() : text;
}

/** Digits only (NPIs, tax IDs, ZIPs, phone numbers). */
export const digits = (value: string | null | undefined) => (value ?? '').replace(/\D/g, '');

/** Left-justified, space-padded fixed width (ISA). */
export function pad(value: string, width: number): string {
  return clean(value, width).padEnd(width, ' ');
}

/** Zero-padded number (control numbers). */
export function zeroPad(value: number, width: number): string {
  return String(value).padStart(width, '0').slice(-width);
}

/** A segment from its elements, trailing empty elements dropped (X12 rule). */
export function segment(id: string, ...elements: (string | number | null | undefined)[]): string {
  const values = elements.map((e) => (e === null || e === undefined ? '' : String(e)));
  while (values.length && values[values.length - 1] === '') values.pop();
  return [id, ...values].join(ELEMENT) + TERMINATOR;
}

/** A composite element (e.g. `HC:T1019:U1`), trailing empty components dropped. */
export function composite(...parts: (string | null | undefined)[]): string {
  const values = parts.map((p) => p ?? '');
  while (values.length && values[values.length - 1] === '') values.pop();
  return values.join(COMPONENT);
}

/** 2026-09-28 → 20260928 (CCYYMMDD). */
export const ccyymmdd = (isoDate: string) => isoDate.slice(0, 10).replaceAll('-', '');

/** Money with up to 2 decimals, no trailing zeros (X12 R type): 24.00 → 24, 12.50 → 12.5. */
export function amount(value: number): string {
  return String(Math.round(value * 100) / 100);
}
