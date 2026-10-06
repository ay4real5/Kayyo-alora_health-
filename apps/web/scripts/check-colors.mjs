// Design-token guard (D-103): colours come from brand-*/accent-* tokens in src/app/globals.css, never the old
// violet/indigo/fuchsia/purple/pink classes. Runs with `npm run lint`.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const FORBIDDEN = /\b(violet|indigo|fuchsia|purple|pink)-(50|[1-9]00|950)\b/g;
const problems = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (/\.(tsx?|css)$/.test(name)) {
      readFileSync(path, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          for (const m of line.matchAll(FORBIDDEN)) problems.push(`${path}:${i + 1}  ${m[0]}  → use brand-/accent- tokens`);
        });
    }
  }
}
walk('src');
if (problems.length) {
  console.error(`Colour classes outside the design tokens (D-103):\n${problems.join('\n')}`);
  process.exit(1);
}
console.log('Colour tokens OK');
