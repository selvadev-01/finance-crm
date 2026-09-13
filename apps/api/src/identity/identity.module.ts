import { Module } from '@nestjs/common';

import { PasswordHasher } from './password-hasher.js';
import { StaffController } from './staff.controller.js';
import { StaffDirectoryService } from './staff-directory.service.js';
import { StaffPasswordService } from './staff-password.service.js';

/** M01 Identity — staff administration. Sign-in itself is `RasiAuthModule`. */
@Module({
  controllers: [StaffController],
  providers: [PasswordHasher, StaffDirectoryService, StaffPasswordService],
})
export class IdentityModule {}
