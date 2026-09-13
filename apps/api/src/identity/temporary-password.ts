import { randomInt } from 'node:crypto';

/**
 * Letters and digits a person can read aloud over a phone without ambiguity:
 * no `0`/`O`, `1`/`I`/`L`, and upper case only.
 */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const LENGTH = 12;

/**
 * A one-time password for an Admin reset (US-003). 12 characters from a
 * 31-symbol alphabet is about 59 bits — ample for a password that is valid only
 * until its first use and is replaced at the next sign-in. Generated with a
 * CSPRNG (`crypto.randomInt`), never `Math.random`.
 */
export function generateTemporaryPassword(): string {
  let password = '';
  for (let i = 0; i < LENGTH; i += 1) {
    password += ALPHABET[randomInt(ALPHABET.length)];
  }
  return password;
}
