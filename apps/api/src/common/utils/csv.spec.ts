import { describe, expect, it } from 'vitest';
import { csvCell, csvRows } from './csv.js';

describe('csvCell', () => {
  it('neutralises text that a spreadsheet would run as a formula', () => {
    expect(csvCell('=HYPERLINK("http://evil","x")')).toBe(`"'=HYPERLINK(""http://evil"",""x"")"`);
    expect(csvCell('+1+cmd|calc')).toBe("'+1+cmd|calc");
    expect(csvCell('-2+3')).toBe("'-2+3");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('\tTAB')).toBe("'\tTAB");
    expect(csvCell('\r=1')).toBe(`"'\r=1"`);
  });

  it('leaves numbers and ordinary text alone', () => {
    expect(csvCell(-5)).toBe('-5');
    expect(csvCell('-5.00')).toBe('-5.00');
    expect(csvCell('12.50')).toBe('12.50');
    expect(csvCell('Smith, Jo')).toBe('"Smith, Jo"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell(null)).toBe('');
    expect(csvCell(new Date('2026-09-29T00:00:00Z'))).toBe('2026-09-29T00:00:00.000Z');
  });

  it('joins rows with CRLF and ends with one', () => {
    expect(csvRows([['a', 'b'], [1, '=x']])).toBe("a,b\r\n1,'=x\r\n");
  });
});
