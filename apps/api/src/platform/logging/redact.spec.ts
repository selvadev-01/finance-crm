import { REDACTED, redactLogLine, redactLogValue } from './redact.js';

describe('allowlist log redaction (M16)', () => {
  it('keeps allowlisted keys and their values', () => {
    expect(
      redactLogValue({
        level: 30,
        msg: 'collection confirmed',
        requestId: 'req_1',
        collectionId: 'col_1',
        amount: '100.00',
      }),
    ).toEqual({
      level: 30,
      msg: 'collection confirmed',
      requestId: 'req_1',
      collectionId: 'col_1',
      amount: '100.00',
    });
  });

  it.each([
    ['a password', { password: 'hunter2-hunter2' }],
    ['a session token', { token: 'tok_abc' }],
    [
      'a cookie header',
      { headers: { cookie: 'better-auth.session_token=abc' } },
    ],
    ['an authorization header', { authorization: 'Bearer abc' }],
    [
      'push subscription keys',
      {
        subscription: {
          endpoint: 'https://push',
          keys: { p256dh: 'BN...', auth: 'xyz' },
        },
      },
    ],
    ['a phone number', { phone: '+91 98765 43210' }],
    ['a key nobody thought of', { someNewField: 'anything' }],
  ])('redacts %s — the value never survives', (_label, input) => {
    const output = JSON.stringify(redactLogValue(input));
    for (const leaf of leaves(input)) {
      expect(output).not.toContain(leaf);
    }
    expect(output).toContain(REDACTED);
  });

  it('keeps the name of a redacted key, so it is visible that a field was dropped', () => {
    expect(redactLogValue({ password: 'x' })).toEqual({ password: REDACTED });
  });

  it('applies at every depth, including inside allowlisted keys and arrays', () => {
    expect(
      redactLogValue({
        err: { message: 'boom', cause: { password: 'x' } },
        details: [{ field: 'amount', issue: 'required', value: 'x' }],
      }),
    ).toEqual({
      err: { message: 'boom', cause: REDACTED },
      details: [{ field: 'amount', issue: 'required', value: REDACTED }],
    });
  });

  it('redacts a whole serialized line and terminates it with a newline', () => {
    const line = redactLogLine(
      JSON.stringify({ level: 30, msg: 'sign in', password: 'secret-pw' }),
    );
    expect(line.endsWith('\n')).toBe(true);
    expect(line).not.toContain('secret-pw');
    expect(JSON.parse(line)).toEqual({
      level: 30,
      msg: 'sign in',
      password: REDACTED,
    });
  });

  it('replaces a line it cannot parse rather than passing it through', () => {
    const line = redactLogLine('password=secret-pw not json');
    expect(line).not.toContain('secret-pw');
  });
});

function leaves(value: unknown): string[] {
  if (value === null || typeof value !== 'object') return [String(value)];
  return Object.values(value).flatMap(leaves);
}
