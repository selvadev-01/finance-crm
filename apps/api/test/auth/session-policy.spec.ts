import {
  isPastAbsoluteLimit,
  SESSION_ABSOLUTE_LIMIT_SECONDS,
  SESSION_EXPIRES_IN_SECONDS,
  SESSION_UPDATE_AGE_SECONDS,
} from '../../src/auth/session-policy.js';

describe('session absolute limit', () => {
  const now = new Date('2026-09-19T10:00:00.000Z');
  const signedInAgo = (seconds: number) =>
    new Date(now.getTime() - seconds * 1000);

  it('is 30 days, the NIST SP 800-63B ceiling for password-only sign-in', () => {
    expect(SESSION_ABSOLUTE_LIMIT_SECONDS).toBe(30 * 24 * 60 * 60);
  });

  it('keeps a session one second short of 30 days', () => {
    expect(
      isPastAbsoluteLimit(signedInAgo(SESSION_ABSOLUTE_LIMIT_SECONDS - 1), now),
    ).toBe(false);
  });

  it('ends a session exactly 30 days after sign-in', () => {
    expect(
      isPastAbsoluteLimit(signedInAgo(SESSION_ABSOLUTE_LIMIT_SECONDS), now),
    ).toBe(true);
  });

  it('reads a creation time serialised as an ISO string', () => {
    const created = signedInAgo(SESSION_ABSOLUTE_LIMIT_SECONDS + 60);
    expect(isPastAbsoluteLimit(created.toISOString(), now)).toBe(true);
  });
});

/**
 * US-001, "Field device stays signed in": a Junior returning the next morning
 * without connectivity is still signed in. The offline route itself is proven
 * in the offline E2E suite (US-051); this pins the session it relies on.
 */
describe('a field device stays signed in (US-001)', () => {
  const DAY = 24 * 60 * 60;

  it('outlasts a night and a Sunday without a network — seven days', () => {
    expect(SESSION_EXPIRES_IN_SECONDS).toBe(7 * DAY);
    // Saturday evening to Monday morning, with room to spare.
    expect(SESSION_EXPIRES_IN_SECONDS).toBeGreaterThan(2 * DAY);
  });

  it('is renewed by a day of use, so a Junior online once a week is never stopped at the door', () => {
    expect(SESSION_UPDATE_AGE_SECONDS).toBe(DAY);
    expect(SESSION_UPDATE_AGE_SECONDS).toBeLessThan(SESSION_EXPIRES_IN_SECONDS);
  });
});
