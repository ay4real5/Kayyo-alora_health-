import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

export interface InvoicePdfData {
  agency: { name: string; addressLines: string[]; phone: string | null; email: string | null; taxId: string | null };
  invoiceNumber: string;
  issueDate: string;
  dueDate: string;
  periodStart: string;
  periodEnd: string;
  billTo: { name: string; addressLines: string[] };
  patientName: string;
  lines: { serviceDate: string; description: string; quantity: number; unitRate: number; total: number }[];
  subtotal: number;
  tax: number;
  total: number;
  paid: number;
  balance: number;
  status: string;
  notes: string | null;
}

const money = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const usDate = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return `${m}/${d}/${y}`;
};

/** The standard PDF fonts only cover Latin-1; anything else is folded to its base letter or replaced. */
function printable(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[–—]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\x20-\x7e\xa0-\xff]/g, '?');
}

/**
 * A one-or-more-page US Letter invoice (D-059). Plain and printable: agency header, bill-to, visit lines, totals and
 * the balance due. Built with pdf-lib (no headless browser).
 */
export async function renderInvoicePdf(data: InvoicePdfData): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Invoice ${data.invoiceNumber}`);
  pdf.setCreator(data.agency.name);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.1, 0.12, 0.15);
  const grey = rgb(0.4, 0.43, 0.47);
  const teal = rgb(0.07, 0.37, 0.37);
  const [W, H, M] = [612, 792, 50];

  let page: PDFPage = pdf.addPage([W, H]);
  let y = H - M;
  const text = (s: string, x: number, size = 10, f: PDFFont = font, color = ink) =>
    page.drawText(printable(s), { x, y, size, font: f, color });
  const right = (s: string, xRight: number, size = 10, f: PDFFont = font, color = ink) =>
    page.drawText(printable(s), { x: xRight - f.widthOfTextAtSize(printable(s), size), y, size, font: f, color });
  /** Cut to fit the width, ending in "..." when shortened. */
  const fit = (s: string, width: number, size = 10) => {
    let out = printable(s);
    if (font.widthOfTextAtSize(out, size) <= width) return out;
    while (out.length > 1 && font.widthOfTextAtSize(`${out}...`, size) > width) out = out.slice(0, -1);
    return `${out}...`;
  };

  // Header
  text(data.agency.name, M, 16, bold, teal);
  right('INVOICE', W - M, 20, bold, teal);
  y -= 16;
  for (const line of [...data.agency.addressLines, data.agency.phone ?? '', data.agency.email ?? ''].filter(Boolean)) {
    text(line, M, 9, font, grey);
    y -= 12;
  }
  if (data.agency.taxId) {
    text(`Tax ID ${data.agency.taxId}`, M, 9, font, grey);
    y -= 12;
  }

  // Invoice facts (right column) and bill-to (left)
  let factsY = H - M - 30;
  for (const [label, value] of [
    ['Invoice #', data.invoiceNumber],
    ['Invoice date', usDate(data.issueDate)],
    ['Due date', usDate(data.dueDate)],
    ['Service period', `${usDate(data.periodStart)} - ${usDate(data.periodEnd)}`],
  ] as const) {
    const saved = y;
    y = factsY;
    right(label, W - M - 150, 9, font, grey);
    right(value, W - M, 9, bold);
    y = saved;
    factsY -= 13;
  }
  y = Math.min(y, factsY) - 18;
  text('BILL TO', M, 8, bold, grey);
  y -= 13;
  text(data.billTo.name, M, 11, bold);
  y -= 13;
  for (const line of data.billTo.addressLines) {
    text(line, M, 10);
    y -= 12;
  }
  y -= 4;
  text(`For care provided to ${data.patientName}`, M, 9, font, grey);
  y -= 26;

  // Lines
  const cols = { date: M, desc: M + 70, qty: W - M - 170, rate: W - M - 85, total: W - M };
  const header = () => {
    page.drawRectangle({ x: M - 4, y: y - 4, width: W - 2 * M + 8, height: 18, color: rgb(0.93, 0.96, 0.96) });
    text('Date', cols.date, 9, bold);
    text('Service', cols.desc, 9, bold);
    right('Qty', cols.qty, 9, bold);
    right('Rate', cols.rate, 9, bold);
    right('Amount', cols.total, 9, bold);
    y -= 20;
  };
  header();
  for (const l of data.lines) {
    if (y < M + 140) {
      page = pdf.addPage([W, H]);
      y = H - M;
      text(`Invoice ${data.invoiceNumber} (continued)`, M, 9, font, grey);
      y -= 22;
      header();
    }
    text(usDate(l.serviceDate), cols.date, 9);
    text(fit(l.description, cols.qty - cols.desc - 50, 9), cols.desc, 9);
    right(String(l.quantity), cols.qty, 9);
    right(money(l.unitRate), cols.rate, 9);
    right(money(l.total), cols.total, 9);
    y -= 15;
  }

  // Totals
  y -= 6;
  page.drawLine({ start: { x: W - M - 220, y: y + 8 }, end: { x: W - M, y: y + 8 }, thickness: 0.5, color: grey });
  const totalRow = (label: string, value: string, strong = false) => {
    right(label, W - M - 110, 10, strong ? bold : font, strong ? ink : grey);
    right(value, W - M, 10, strong ? bold : font);
    y -= 15;
  };
  totalRow('Subtotal', money(data.subtotal));
  if (data.tax) totalRow('Tax', money(data.tax));
  totalRow('Total', money(data.total), true);
  if (data.paid) totalRow('Paid', `-${money(data.paid)}`);
  y -= 4;
  page.drawRectangle({ x: W - M - 220, y: y - 6, width: 224, height: 22, color: rgb(0.93, 0.96, 0.96) });
  right('Balance due', W - M - 110, 12, bold, teal);
  right(data.status === 'void' ? 'VOID' : money(data.balance), W - M, 12, bold, teal);
  y -= 34;

  if (data.notes) {
    text('Notes', M, 9, bold, grey);
    y -= 12;
    text(fit(data.notes, W - 2 * M, 9), M, 9);
    y -= 16;
  }
  text(`Please make checks payable to ${data.agency.name} and write ${data.invoiceNumber} on the check.`, M, 9, font, grey);
  y -= 12;
  text('Questions about this bill? Call us at the number above.', M, 9, font, grey);

  return Buffer.from(await pdf.save());
}
