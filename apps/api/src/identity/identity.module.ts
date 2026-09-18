import { Module } from '@nestjs/common';

import { SettingsModule } from '../settings/settings.module.js';
import { OrganizationSignUpService } from './organization-sign-up.service.js';
import { PasswordHasher } from './password-hasher.js';
import { SignUpController } from './sign-up.controller.js';
import { SignUpRateLimiter } from './sign-up-rate-limiter.js';
import { StaffController } from './staff.controller.js';
import { StaffAdminService } from './staff-admin.service.js';
import { StaffDirectoryService } from './staff-directory.service.js';
import { StaffPasswordService } from './staff-password.service.js';

/**
 * M01 Identity — organization sign-up and staff administration. Sign-in
 * itself is `RasiAuthModule`.
 */
@Module({
  // M15: `/api/me` carries `account.defaultTermDays` to the account form.
  imports: [SettingsModule],
  controllers: [StaffController, SignUpController],
  providers: [
    PasswordHasher,
    StaffDirectoryService,
    StaffAdminService,
    StaffPasswordService,
    OrganizationSignUpService,
    { provide: SignUpRateLimiter, useFactory: () => new SignUpRateLimiter() },
  ],
})
export class IdentityModule {}
