/**
 * Accepted document files (DECISIONS D-056), recognised by their first bytes — the declared type and file name are
 * not trusted. Anything else is refused.
 */
export const ACCEPTED_FILES = {
  pdf: { mime: 'application/pdf', ext: 'pdf', magic: [0x25, 0x50, 0x44, 0x46, 0x2d] }, // %PDF-
  png: { mime: 'image/png', ext: 'png', magic: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  jpeg: { mime: 'image/jpeg', ext: 'jpg', magic: [0xff, 0xd8, 0xff] },
  docx: {
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ext: 'docx',
    magic: [0x50, 0x4b, 0x03, 0x04], // ZIP; must also be named .docx
  },
} as const;

export type AcceptedKind = keyof typeof ACCEPTED_FILES;

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

/** The kind of file, or null if it isn't one we accept. */
export function detectFileKind(content: Uint8Array, fileName: string): AcceptedKind | null {
  for (const [kind, spec] of Object.entries(ACCEPTED_FILES) as [
    AcceptedKind,
    (typeof ACCEPTED_FILES)[AcceptedKind],
  ][]) {
    if (content.length < spec.magic.length) continue;
    if (!spec.magic.every((byte, i) => content[i] === byte)) continue;
    if (kind === 'docx' && !/\.docx$/i.test(fileName)) continue;
    return kind;
  }
  return null;
}

/** A download file name that can't break the Content-Disposition header. */
export function safeFileName(name: string, kind: AcceptedKind): string {
  const base = (name.split(/[\\/]/).pop() ?? '')
    .replace(/\.[A-Za-z0-9]{1,5}$/, '')
    .replace(/[^A-Za-z0-9 ._-]/g, '')
    .trim()
    .slice(0, 100);
  return `${base || 'document'}.${ACCEPTED_FILES[kind].ext}`;
}
