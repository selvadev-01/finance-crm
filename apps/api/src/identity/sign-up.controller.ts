import { Controller } from '@nestjs/common';
import {
  type RouteInput,
  type RouteSuccess,
  signUpContract as api,
} from '@repo/contracts';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';

import {
  ContractInput,
  ContractRoute,
} from '../platform/contract/contract-route.js';
import { OrganizationSignUpService } from './organization-sign-up.service.js';

/**
 * Organization sign-up and sign-in links (US-006, ADR-0012). Both public:
 * the caller has no account yet. Sign-up is rate-limited per address.
 */
@Controller()
export class SignUpController {
  constructor(private readonly signUps: OrganizationSignUpService) {}

  @AllowAnonymous()
  @ContractRoute(api.signUpOrganization)
  signUpOrganization(
    @ContractInput() { body }: RouteInput<typeof api.signUpOrganization>,
  ): Promise<RouteSuccess<typeof api.signUpOrganization>> {
    return this.signUps.signUp(body);
  }

  @AllowAnonymous()
  @ContractRoute(api.getOrganizationBySlug)
  getOrganizationBySlug(
    @ContractInput() { params }: RouteInput<typeof api.getOrganizationBySlug>,
  ): Promise<RouteSuccess<typeof api.getOrganizationBySlug>> {
    return this.signUps.findBySlug(params.slug);
  }
}
