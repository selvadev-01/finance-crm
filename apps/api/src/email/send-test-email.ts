import { loadConfig } from '../platform/config/config.js';
import { emailProviderFromConfig } from './email-dispatch.service.js';

/**
 * `pnpm --filter api email:test you@example.com` (after `pnpm build`)
 *
 * Sends one email straight through the configured SMTP server — no database,
 * no queue, no worker — to prove the `.env` settings work. Prints whether the
 * server accepted it and, if not, its reply.
 */
async function main() {
  const to = process.argv[2];
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    throw new Error('Usage: pnpm --filter api email:test you@example.com');
  }
  const config = loadConfig();
  const provider = emailProviderFromConfig(config);
  if (!provider) {
    throw new Error(
      'Email is not configured: set EMAIL_PROVIDER=SMTP, SMTP_HOST and EMAIL_FROM in .env',
    );
  }

  const result = await provider.send({
    to,
    subject: 'Rasi test email',
    text: `This is a test email from Rasi.\n\nSMTP server: ${config.SMTP_HOST}:${config.SMTP_PORT}\nSent at: ${new Date().toISOString()}`,
  });

  if (result.status === 'sent') {
    process.stdout.write(
      `Sent to ${to} through ${config.SMTP_HOST}:${config.SMTP_PORT}.\n`,
    );
    process.exit(0);
  }
  process.stderr.write(
    `Not sent (${result.status === 'retry' ? 'temporary' : 'permanent'} failure): ${result.reason}\n`,
  );
  process.exit(1);
}

try {
  await main();
} catch (error) {
  // A usage or configuration mistake: the message is the whole story.
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
}
