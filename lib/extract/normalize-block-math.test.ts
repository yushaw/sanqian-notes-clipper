import { describe, it, expect } from 'vitest';
import { normalizeBlockMath } from './normalize-block-math';

// Mirrors the notes app's block-math-spacing regression test. The two regexes
// must stay in sync; if you change one, change both (see normalize-block-math.ts).
describe('normalizeBlockMath', () => {
  it('pads a $$ block glued to the line above', () => {
    expect(normalizeBlockMath('tokens:\n$$\n\\text{Loss}=x\n$$\n and the model')).toBe(
      'tokens:\n\n$$\n\\text{Loss}=x\n$$\n\n and the model',
    );
  });

  it('pads the real Wikipedia glued form', () => {
    const md = 'features:\n$$\n{\\displaystyle \\varphi (x)}\n$$\n where samples.';
    expect(normalizeBlockMath(md)).toBe(
      'features:\n\n$$\n{\\displaystyle \\varphi (x)}\n$$\n\n where samples.',
    );
  });

  it('pads two glued blocks independently', () => {
    expect(normalizeBlockMath('a:\n$$\nx=1\n$$\n then b:\n$$\ny=2\n$$\n done')).toBe(
      'a:\n\n$$\nx=1\n$$\n\n then b:\n\n$$\ny=2\n$$\n\n done',
    );
  });

  it('collapses existing blank lines to exactly one (no triple newline)', () => {
    expect(normalizeBlockMath('a:\n\n\n$$\nx=1\n$$\n\n\nb')).toBe('a:\n\n$$\nx=1\n$$\n\nb');
  });

  it('leaves a block at start/end of string without stray blank lines', () => {
    expect(normalizeBlockMath('$$\nx=1\n$$')).toBe('$$\nx=1\n$$');
    expect(normalizeBlockMath('$$\nx=1\n$$\nafter')).toBe('$$\nx=1\n$$\n\nafter');
  });

  it('leaves tab-indented $$ (an indented code block) untouched', () => {
    const code = '\t$$\n\tx=1\n\t$$';
    expect(normalizeBlockMath(code)).toBe(code);
  });

  it('does not touch inline $ or lone dollar signs', () => {
    const md = 'price is $5 and $w_1$ inline';
    expect(normalizeBlockMath(md)).toBe(md);
  });

  it('is idempotent on already-normalized input', () => {
    const once = normalizeBlockMath('tokens:\n$$\nx=1\n$$\nmodel');
    expect(normalizeBlockMath(once)).toBe(once);
  });
});
