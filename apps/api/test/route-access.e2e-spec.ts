import { Controller, Get } from '@nestjs/common';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';

import { RequirePermission } from '../src/access/decorators.js';
import { createTestApp } from './app.js';

@Controller('__audit')
class UndeclaredProbeController {
  @AllowAnonymous()
  @Get('public')
  open() {
    return {};
  }

  @RequirePermission('customer.view')
  @Get('declared')
  declared() {
    return {};
  }

  @Get('forgotten')
  forgotten() {
    return {};
  }
}

@AllowAnonymous()
@Controller('__audit-class')
class ClassLevelPublicController {
  @Get()
  index() {
    return {};
  }
}

/**
 * The start-up audit (M02). In its own file: a failed application still
 * replaces nestjs-pino's static root logger, which would disturb other suites.
 */
describe('route access audit (M02, e2e)', () => {
  it('refuses to start an app with a route that declares neither a permission nor @AllowAnonymous(), naming it', async () => {
    await expect(
      createTestApp({ controllers: [UndeclaredProbeController] }),
    ).rejects.toThrow(
      /UndeclaredProbeController\.forgotten \(\/__audit\/forgotten\)/,
    );
  });

  it('names only the undeclared route', async () => {
    const failure = await createTestApp({
      controllers: [UndeclaredProbeController],
    }).catch((error: Error) => error);
    expect(String(failure)).not.toMatch(/\.open|\.declared/);
  });

  it('accepts @AllowAnonymous() on the controller class', async () => {
    const app = await createTestApp({
      controllers: [ClassLevelPublicController],
    });
    await app.close();
  });
});
