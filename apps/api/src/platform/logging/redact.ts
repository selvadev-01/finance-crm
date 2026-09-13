/**
 * Allowlist log redaction (M16, security.md).
 *
 * Every key at every depth of every log line is checked against
 * `SAFE_LOG_KEYS`. A key on the list keeps its value; any other key keeps its
 * **name** but its value becomes `"[REDACTED]"`. A denylist is a list of the
 * leaks you thought of; here the default for anything new is redacted, and the
 * visible key tells the developer to add it deliberately.
 *
 * It runs on the finished JSON line (`hooks.streamWrite`), after serializers,
 * bindings and child loggers, so nothing reaches the output around it.
 *
 * **Adding a key is a security decision.** Never add a key whose value could
 * be a password, token, cookie, header, request body, push subscription key,
 * or personal data such as a phone number. Money amounts are safe, and must be
 * logged as strings (BR-11).
 */
export const REDACTED = '[REDACTED]';

export const SAFE_LOG_KEYS: ReadonlySet<string> = new Set([
  // pino and pino-http envelope
  'level',
  'time',
  'pid',
  'hostname',
  'msg',
  'context',
  'requestId',
  'req',
  'res',
  'responseTime',
  'id',
  'method',
  'url',
  'statusCode',
  // errors
  'err',
  'type',
  'message',
  'stack',
  'code',
  'status',
  'details',
  'field',
  'issue',
  // identifiers — opaque ids, never names or contact details
  'userId',
  'accountLoanId',
  'collectionId',
  'customerId',
  'lineId',
  'sectorId',
  // values
  'amount',
  'durationMs',
  'count',
]);

/** Returns a copy of `value` with every non-allowlisted key's value redacted. */
export function redactLogValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactLogValue);
  if (value === null || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, inner]) => [
      key,
      SAFE_LOG_KEYS.has(key) ? redactLogValue(inner) : REDACTED,
    ]),
  );
}

/**
 * The `hooks.streamWrite` implementation: one serialized pino line in, the
 * redacted line out. A line that is not JSON is replaced wholesale rather than
 * passed through, so a formatting change can never become a leak.
 */
export function redactLogLine(line: string): string {
  try {
    const parsed: unknown = JSON.parse(line);
    return `${JSON.stringify(redactLogValue(parsed))}\n`;
  } catch {
    return `${JSON.stringify({ level: 50, msg: 'unparseable log line redacted' })}\n`;
  }
}
