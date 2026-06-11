import { describe, expect, it } from 'vitest';
import { epochToLocalDate } from './epoch-date';

describe('epochToLocalDate', () => {
  it('formats in the local timezone, consistent with Date getters', () => {
    const epoch = 1706846400; // 2024-02-02 12:00 +08:00
    const d = new Date(epoch * 1000);
    const expected = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    expect(epochToLocalDate(epoch)).toBe(expected);
  });

  it('does not shift early-morning CST timestamps to the previous UTC day', () => {
    // 2026-06-11 01:30 +08:00 == 2026-06-10 17:30 UTC. In any UTC+8 zone the
    // local date must be the 11th; toISOString() would have said the 10th.
    const epoch = Date.UTC(2026, 5, 10, 17, 30) / 1000;
    if (new Date().getTimezoneOffset() === -480) {
      expect(epochToLocalDate(epoch)).toBe('2026-06-11');
    }
  });
});
