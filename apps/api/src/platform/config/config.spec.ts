import { ConfigValidationError, parseConfig } from './config.js';

const valid = {
  DATABASE_URL:
    'postgresql://rasi:secret@localhost:5432/rasi_dev?schema=public',
  BETTER_AUTH_SECRET: 'a-development-secret-value',
  WEB_ORIGIN: 'http://localhost:3000',
};

function problemsFor(env: Record<string, string | undefined>): string[] {
  try {
    parseConfig(env);
  } catch (error) {
    if (error instanceof ConfigValidationError) return error.problems;
    throw error;
  }
  throw new Error('expected parseConfig to reject this environment');
}

describe('configuration (M16)', () => {
  it('accepts a complete environment and applies defaults', () => {
    const config = parseConfig(valid);
    expect(config).toMatchObject({
      NODE_ENV: 'development',
      PORT: 3001,
      LOG_LEVEL: 'info',
      WEB_ORIGIN: 'http://localhost:3000',
    });
    expect(config.BUILD_ID).toBeUndefined();
  });

  it('coerces PORT from its string form', () => {
    expect(parseConfig({ ...valid, PORT: '8080' }).PORT).toBe(8080);
  });

  it('reports every problem at once, not only the first', () => {
    const problems = problemsFor({ PORT: 'eighty', LOG_LEVEL: 'loud' });
    expect(problems).toHaveLength(5);
    expect(problems.join('\n')).toMatch(/DATABASE_URL is required/);
    expect(problems.join('\n')).toMatch(/BETTER_AUTH_SECRET is required/);
    expect(problems.join('\n')).toMatch(/WEB_ORIGIN is required/);
    // Present but malformed is not "required" — the message must say what is wrong.
    expect(problems.find((p) => p.startsWith('PORT '))).not.toMatch(/required/);
    expect(problems.find((p) => p.startsWith('LOG_LEVEL '))).not.toMatch(
      /required/,
    );
  });

  it('treats a variable left blank in .env as missing', () => {
    expect(problemsFor({ ...valid, DATABASE_URL: '' })).toEqual([
      'DATABASE_URL is required',
    ]);
  });

  it('never includes a value in the message, since it may be a secret', () => {
    const secret = 'short-secret';
    let message = '';
    try {
      parseConfig({ ...valid, BETTER_AUTH_SECRET: secret });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/BETTER_AUTH_SECRET/);
    expect(message).not.toContain(secret);
  });

  it.each([
    [
      'a non-PostgreSQL database URL',
      { DATABASE_URL: 'mysql://localhost/rasi' },
      'DATABASE_URL',
    ],
    [
      'the CHANGEME placeholder secret',
      { BETTER_AUTH_SECRET: 'CHANGEME' },
      'BETTER_AUTH_SECRET',
    ],
    [
      'a web origin with a path',
      { WEB_ORIGIN: 'http://localhost:3000/app' },
      'WEB_ORIGIN',
    ],
    [
      'a web origin that is not http(s)',
      { WEB_ORIGIN: 'ftp://localhost' },
      'WEB_ORIGIN',
    ],
    ['an unknown NODE_ENV', { NODE_ENV: 'staging' }, 'NODE_ENV'],
    ['a port out of range', { PORT: '70000' }, 'PORT'],
  ])('rejects %s', (_label, override, variable) => {
    const problems = problemsFor({ ...valid, ...override });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(new RegExp(`^${variable} `));
  });

  it('requires a 32-character secret in production only', () => {
    expect(() =>
      parseConfig({ ...valid, NODE_ENV: 'development' }),
    ).not.toThrow();
    expect(problemsFor({ ...valid, NODE_ENV: 'production' })).toEqual([
      'BETTER_AUTH_SECRET must be at least 32 characters in production',
    ]);
  });

  it('returns a frozen object', () => {
    expect(Object.isFrozen(parseConfig(valid))).toBe(true);
  });
});
