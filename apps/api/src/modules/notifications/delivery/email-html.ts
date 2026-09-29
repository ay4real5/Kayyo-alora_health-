/**
 * The HTML version of an email (D-085): the same words as the plain-text version, in a simple branded layout. Built
 * only from that text, so it can never say more than the text does (PHI-free by the same contract). Inline styles and
 * a table layout, because email clients ignore most CSS.
 */

const escapeHtml = (s: string) =>
  s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');

const URL_PATTERN = /https?:\/\/[^\s<>"']+/g;

/** Escapes a line and turns its web addresses into links. */
function lineHtml(line: string): string {
  let out = '';
  let last = 0;
  for (const match of line.matchAll(URL_PATTERN)) {
    const url = match[0];
    out += escapeHtml(line.slice(last, match.index));
    out += `<a href="${escapeHtml(url)}" style="color:#6d28d9;word-break:break-all">${escapeHtml(url)}</a>`;
    last = match.index + url.length;
  }
  return out + escapeHtml(line.slice(last));
}

/** A line that is only a link becomes a button, e.g. the password reset link. */
function buttonHtml(url: string): string {
  const href = escapeHtml(url);
  return (
    `<p style="margin:24px 0"><a href="${href}" style="display:inline-block;background:#6d28d9;color:#ffffff;` +
    `text-decoration:none;font-weight:600;padding:12px 22px;border-radius:10px">Open Primordial Health</a></p>` +
    `<p style="margin:0 0 16px;font-size:13px;color:#5b6477">Or copy this link: ` +
    `<a href="${href}" style="color:#6d28d9;word-break:break-all">${href}</a></p>`
  );
}

export function emailHtml(subject: string, text: string): string {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((block) => block.split('\n').filter((l) => l.trim() !== ''))
    .filter((lines) => lines.length > 0)
    .map((lines) => {
      const html: string[] = [];
      const words: string[] = [];
      const flush = () => {
        if (words.length) html.push(`<p style="margin:0 0 16px">${words.join('<br>')}</p>`);
        words.length = 0;
      };
      for (const line of lines) {
        const only = line.trim();
        if (/^https?:\/\/\S+$/.test(only)) {
          flush();
          html.push(buttonHtml(only));
        } else {
          words.push(lineHtml(line));
        }
      }
      flush();
      return html.join('');
    })
    .join('');

  return [
    '<!doctype html><html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    `<title>${escapeHtml(subject)}</title></head>`,
    '<body style="margin:0;padding:0;background:#f5f5fa">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5fa"><tr><td align="center" style="padding:24px 12px">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden">',
    '<tr><td style="background:#312e81;padding:18px 24px;font-family:Segoe UI,Arial,sans-serif;font-size:18px;font-weight:700;color:#ffffff">Primordial Health</td></tr>',
    `<tr><td style="padding:24px;font-family:Segoe UI,Arial,sans-serif;font-size:15px;line-height:1.55;color:#0f172a">${paragraphs}</td></tr>`,
    '<tr><td style="padding:16px 24px;border-top:1px solid #e2e8f0;font-family:Segoe UI,Arial,sans-serif;font-size:12px;color:#5b6477">',
    'Primordial Health Services · This is an automated message; replies aren’t read.',
    '</td></tr></table></td></tr></table></body></html>',
  ].join('');
}
