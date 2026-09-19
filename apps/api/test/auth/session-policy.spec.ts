import {
  isPastAbsoluteLimit,
  SESSION_ABSOLUTE_LIMIT_SECONDS,
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
