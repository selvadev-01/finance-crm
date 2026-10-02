import { getPrismaClient } from '@repo/db';
import { isKnownPushEndpoint } from '@repo/notifications';

import { loadConfig } from '../platform/config/config.js';
import { pushProvidersFromConfig } from './push-dispatch.service.js';

/**
 * `pnpm --filter api push:test you@example.com` (after `pnpm build`)
 *
 * Sends one test push straight through the configured Web Push provider — no
 * queue, no worker — to every browser that staff member has registered, to
 * prove the `.env` VAPID keys reach a real push service. **Writes nothing**: it
 * reads the subscriptions and reports each result; a dead one is left for the
 * `dispatch-notifications` job to deactivate. The person must first allow
 * notifications in Settings → Notifications on that browser.
 */
async function main() {
  const email = process.argv[2]?.toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Usage: pnpm --filter api push:test you@example.com');
  }
  const config = loadConfig();
  const provider = pushProvidersFromConfig(config).find(
    (candidate) => candidate.name === 'WEB_PUSH',
  );
  if (!provider) {
    throw new Error(
      'Web Push is not configured: set PUSH_PROVIDER=WEB_PUSH (or BOTH), VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT in .env',
    );
  }

  const prisma = getPrismaClient();
  try {
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, name: true },
    });
    if (!user) throw new Error(`No user has the email ${email}.`);
    const devices = await prisma.pushSubscription.findMany({
      where: { userId: user.id, provider: 'WEB_PUSH', isActive: true },
      select: {
        endpoint: true,
        p256dh: true,
        auth: true,
        deviceLabel: true,
        lastSeenAt: true,
      },
      orderBy: { lastSeenAt: 'desc' },
    });
    if (devices.length === 0) {
      throw new Error(
        `${user.name} has no browser registered for push. Sign in as them, open Settings → Notifications and allow notifications, then run this again.`,
      );
    }

    let sent = 0;
    for (const device of devices) {
      const label = device.deviceLabel ?? new URL(device.endpoint!).host;
      if (!isKnownPushEndpoint(device.endpoint ?? '')) {
        process.stdout.write(`${label}: skipped — not a known push service\n`);
        continue;
      }
      const result = await provider.send(
        {
          provider: 'WEB_PUSH',
          endpoint: device.endpoint!,
          p256dh: device.p256dh!,
          auth: device.auth!,
        },
        {
          title: 'Rasi test notification',
          body: `Push works on this device. Sent ${new Date().toISOString()}.`,
          data: {
            notificationId: 'push-test',
            entityType: null,
            entityId: null,
            url: '/home',
          },
        },
      );
      if (result.status === 'sent') sent += 1;
      process.stdout.write(
        `${label}: ${result.status}${result.status === 'sent' ? '' : ` — ${result.reason}`}\n`,
      );
    }
    process.stdout.write(
      `${sent} of ${devices.length} device${devices.length === 1 ? '' : 's'} accepted the push for ${user.name}.\n`,
    );
    process.exitCode = sent > 0 ? 0 : 1;
  } finally {
    await prisma.$disconnect();
  }
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
