import { Module } from '@nestjs/common';

import { AccessModule } from './access/access.module.js';
import { AccountsModule } from './accounts/accounts.module.js';
import { AuditModule } from './audit/audit.module.js';
import { CalendarModule } from './calendar/calendar.module.js';
import { CashModule } from './cash/cash.module.js';
import { CollectionsModule } from './collections/collections.module.js';
import { RasiAuthModule } from './auth/auth.module.js';
import { CustomersModule } from './customers/customers.module.js';
import { DashboardsModule } from './dashboards/dashboards.module.js';
import { EmailModule } from './email/email.module.js';
import { IdentityModule } from './identity/identity.module.js';
import { JobsModule } from './jobs/jobs.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { OrganisationModule } from './organisation/organisation.module.js';
import { PlatformModule } from './platform/platform.module.js';
import { ReportsModule } from './reports/reports.module.js';
import { SettingsModule } from './settings/settings.module.js';

/**
 * The application root.
 *
 * Modules arrive here one directory per M01–M16 as they are built. So far:
 * M16 Platform (config, logging, errors, database access, `/health/*`), M02
 * Access Control (the global `PolicyGuard`), and Better Auth's `/api/auth/*`.
 */
@Module({
  imports: [
    PlatformModule,
    AuditModule,
    EmailModule,
    NotificationsModule,
    RasiAuthModule,
    AccessModule,
    SettingsModule,
    IdentityModule,
    OrganisationModule,
    CalendarModule,
    CustomersModule,
    AccountsModule,
    CollectionsModule,
    CashModule,
    DashboardsModule,
    ReportsModule,
    JobsModule,
  ],
})
export class AppModule {}
