import { describe, expect, it } from 'vitest';
import { priorityBreakdown, priorityScore } from '@corridor/core';

describe('priority score P = 0.5*S + 0.3*(1/ETA) + 0.2*W', () => {
  it('weights the normalised terms as specified', () => {
    const b = priorityBreakdown({ severity: 5, etaSeconds: 10, waitSeconds: 120 });
    expect(b.severityTerm).toBeCloseTo(0.5);
    expect(b.etaTerm).toBeCloseTo(0.3);
    expect(b.waitTerm).toBeCloseTo(0.2);
    expect(b.score).toBeCloseTo(1);
  });

  it('favours severity, then imminence, then accumulated waiting', () => {
    const cardiac = priorityScore({ severity: 5, etaSeconds: 40, waitSeconds: 0 });
    const theft = priorityScore({ severity: 2, etaSeconds: 40, waitSeconds: 0 });
    expect(cardiac).toBeGreaterThan(theft);

    const near = priorityScore({ severity: 3, etaSeconds: 10, waitSeconds: 0 });
    const far = priorityScore({ severity: 3, etaSeconds: 80, waitSeconds: 0 });
    expect(near).toBeGreaterThan(far);

    const waited = priorityScore({ severity: 3, etaSeconds: 40, waitSeconds: 60 });
    expect(waited).toBeGreaterThan(priorityScore({ severity: 3, etaSeconds: 40, waitSeconds: 0 }));
  });

  it('clamps out-of-range inputs', () => {
    expect(priorityScore({ severity: 9, etaSeconds: 0, waitSeconds: 9999 })).toBeLessThanOrEqual(1);
    expect(priorityScore({ severity: 0, etaSeconds: 1e6, waitSeconds: 0 })).toBeGreaterThanOrEqual(0);
  });
});
