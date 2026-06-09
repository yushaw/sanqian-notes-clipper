import { describe, expect, it } from 'vitest';
import { buildFrontmatter } from './frontmatter';
import type { ClipFrontmatter } from './handlers/types';

const CLIPPED_AT = '2026-06-09T12:00:00.000Z';

function base(extra: Partial<ClipFrontmatter> = {}): ClipFrontmatter {
  return { title: 'A Paper', source: 'https://arxiv.org/html/2606.03920v1', ...extra };
}

describe('buildFrontmatter', () => {
  it('omits fallback fields for a normal clip', () => {
    const fm = buildFrontmatter(base(), CLIPPED_AT);
    expect(fm).not.toContain('fallback');
  });

  it('emits fallback + fallback_reason when a delegated import degraded', () => {
    const fm = buildFrontmatter(
      base({ fallback: 'import_arxiv-failed', fallbackReason: 'Failed to fetch arXiv metadata: 404' }),
      CLIPPED_AT,
    );
    expect(fm).toContain('fallback: import_arxiv-failed');
    // A real error message has a colon, which must be quoted to stay valid YAML.
    expect(fm).toContain('fallback_reason: "Failed to fetch arXiv metadata: 404"');
  });
});
