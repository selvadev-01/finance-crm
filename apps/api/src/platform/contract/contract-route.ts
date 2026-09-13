import {
  applyDecorators,
  type CallHandler,
  createParamDecorator,
  type ExecutionContext,
  HttpCode,
  Injectable,
  type NestInterceptor,
  RequestMapping,
  RequestMethod,
  SetMetadata,
  UseInterceptors,
} from '@nestjs/common';
import {
  type RouteDefinition,
  type RouteInput,
  successStatus,
} from '@repo/contracts';
import type { Request } from 'express';
import { map, type Observable } from 'rxjs';
import { ZodError } from 'zod';

import { InternalError } from '../errors/errors.js';

const CONTRACT_ROUTE = 'rasi:contract-route';

/**
 * Binds a handler to a route in `@repo/contracts` (ADR-0011): method and path
 * from the contract, the contract's success status, and a response shaped by
 * the contract's schema.
 *
 * **Responses are parsed, not merely checked.** Zod object schemas drop keys
 * they do not declare, so a field a service returns by accident — an invested
 * amount on a Junior's payload — never reaches the client unless the contract
 * names it.
 */
export function ContractRoute(definition: RouteDefinition) {
  return applyDecorators(
    RequestMapping({
      path: definition.path,
      method: RequestMethod[definition.method],
    }),
    HttpCode(successStatus(definition)),
    SetMetadata(CONTRACT_ROUTE, definition),
    UseInterceptors(ContractResponseInterceptor),
  );
}

function routeOf(context: ExecutionContext): RouteDefinition {
  const definition = Reflect.getMetadata(
    CONTRACT_ROUTE,
    context.getHandler(),
  ) as RouteDefinition | undefined;
  if (!definition) {
    throw new InternalError(
      'CONTRACT_ROUTE_MISSING',
      '@ContractInput() used on a handler without @ContractRoute()',
    );
  }
  return definition;
}

/**
 * The request's path parameters, query and body, validated against the
 * contract. A `ZodError` becomes `400 VALIDATION_FAILED` with field detail.
 * Runs after the guards, so an unauthenticated request is refused before its
 * body is examined.
 */
export const ContractInput = createParamDecorator(
  (_data: unknown, context: ExecutionContext): RouteInput<RouteDefinition> => {
    const definition = routeOf(context);
    const request = context.switchToHttp().getRequest<Request>();
    return {
      params: definition.pathParams?.parse(request.params),
      query: definition.query?.parse(request.query ?? {}),
      body: definition.body?.parse(request.body ?? {}),
    } as RouteInput<RouteDefinition>;
  },
);

/**
 * What a handler returns for an idempotent replay (BR-13): the original body,
 * answered with the route's `replayStatus` (200) instead of its success
 * status. Only a route that declares `replayStatus` may return one.
 */
export class Replayed<Body> {
  constructor(readonly body: Body) {}
}

@Injectable()
export class ContractResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const definition = routeOf(context);
    const schema = definition.responses[successStatus(definition)];
    return next.handle().pipe(
      map((result: unknown) => {
        let body = result;
        if (result instanceof Replayed) {
          if (definition.replayStatus === undefined) {
            throw new InternalError(
              'REPLAY_NOT_DECLARED',
              `${definition.method} ${definition.path} returned a replay but declares no replayStatus`,
            );
          }
          // Nest set the success status before the handler ran and does not
          // set it again, so this is the status the client receives.
          context
            .switchToHttp()
            .getResponse<{ status(code: number): unknown }>()
            .status(definition.replayStatus);
          body = result.body;
        }
        if (!schema) return body;
        try {
          return schema.parse(body);
        } catch (error) {
          // The server broke its own contract: a bug, not a bad request.
          if (error instanceof ZodError) {
            throw new InternalError(
              'RESPONSE_CONTRACT_VIOLATION',
              `${definition.method} ${definition.path} returned a body that does not match its contract`,
            );
          }
          throw error;
        }
      }),
    );
  }
}
