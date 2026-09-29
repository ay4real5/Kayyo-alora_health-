import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';

/**
 * WCAG 2.1 A/AA problems on the current page (axe-core), in a short readable form. Map tiles are a third-party drawing
 * (their container is labelled); everything else is checked. Automated checks catch roughly a third of real problems —
 * keyboard and screen-reader testing by people is still needed — but they keep regressions out.
 */
export async function wcagViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .exclude('.leaflet-container')
    .analyze();
  return results.violations.map((v) => ({
    rule: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.slice(0, 3).map((n) => n.target.join(' ')),
  }));
}
