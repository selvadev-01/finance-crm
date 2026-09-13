import { Injectable } from '@nestjs/common';

import { auth } from '../auth/auth.config.js';

/**
 * Hashes passwords exactly as Better Auth verifies them at sign-in, by using
 * Better Auth's own configured hasher. A separate hashing library here would be
 * a second definition of "a valid password hash" that could drift from the one
 * sign-in checks.
 */
@Injectable()
export class PasswordHasher {
  async hash(password: string): Promise<string> {
    const context = await auth.$context;
    return context.password.hash(password);
  }

  async verify(hash: string, password: string): Promise<boolean> {
    const context = await auth.$context;
    return context.password.verify({ hash, password });
  }
}
