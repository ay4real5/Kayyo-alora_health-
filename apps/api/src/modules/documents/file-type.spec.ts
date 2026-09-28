import { describe, expect, it } from 'vitest';
import { detectFileKind, safeFileName } from './file-type.js';

const bytes = (...b: number[]) => new Uint8Array([...b, 0, 0, 0, 0, 0, 0, 0, 0]);

describe('detectFileKind', () => {
  it('recognises files by content, not name', () => {
    expect(detectFileKind(bytes(0x25, 0x50, 0x44, 0x46, 0x2d), 'anything.txt')).toBe('pdf');
    expect(detectFileKind(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), 'x')).toBe('png');
    expect(detectFileKind(bytes(0xff, 0xd8, 0xff, 0xe0), 'photo.jpeg')).toBe('jpeg');
  });

  it('accepts ZIP only as a .docx, and refuses everything else', () => {
    expect(detectFileKind(bytes(0x50, 0x4b, 0x03, 0x04), 'letter.docx')).toBe('docx');
    expect(detectFileKind(bytes(0x50, 0x4b, 0x03, 0x04), 'archive.zip')).toBeNull();
    expect(detectFileKind(bytes(0x4d, 0x5a), 'setup.pdf')).toBeNull(); // an .exe named .pdf
    expect(detectFileKind(new TextEncoder().encode('<html><script>'), 'x.pdf')).toBeNull();
  });
});

describe('safeFileName', () => {
  it('strips header-breaking characters and uses the real extension', () => {
    expect(safeFileName('Consent "form"\r\n.PDF', 'pdf')).toBe('Consent form.pdf');
    expect(safeFileName('../../etc/passwd', 'png')).toBe('passwd.png');
    expect(safeFileName('', 'jpeg')).toBe('document.jpg');
    expect(safeFileName('C:\\Users\\me\\scan.PDF', 'pdf')).toBe('scan.pdf');
  });
});
