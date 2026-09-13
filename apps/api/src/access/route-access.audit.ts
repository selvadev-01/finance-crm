import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { RequestMethod } from '@nestjs/common';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';

import { PERMISSION_METADATA } from './decorators.js';
import type { Permission } from './permissions.js';

const PUBLIC_METADATA = 'PUBLIC';

/** One HTTP route as the application actually serves it. */
export interface RouteEntry {
  /** `OrganisationController.createLine` */
  handler: string;
  method: string;
  /** Full path with `:param` segments, e.g. `/api/lines/:lineId`. */
  path: string;
  /** The declared permission, or `null` on a public route. */
  permission: Permission | null;
  isPublic: boolean;
}

function joinPath(...parts: string[]): string {
  const joined = parts
    .map((part) => part.replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/');
  return `/${joined}`;
}

/**
 * The application's route catalogue and its start-up audit (M02).
 *
 * `routes()` lists every route with its declared access — the source for the
 * RBAC matrix test harness, which therefore covers each new endpoint without
 * anyone adding it to a list.
 *
 * On bootstrap, an application with a route that declares neither
 * `@RequirePermission` nor `@AllowAnonymous()` refuses to start. `PolicyGuard`
 * already refuses such a route at runtime with `403`, so this is not the
 * control — it moves the discovery from "a user hit it" to "the app did not
 * boot", which is where a forgotten decorator should be found.
 */
@Injectable()
export class RouteAccessAudit implements OnApplicationBootstrap {
  constructor(
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
    private readonly reflector: Reflector,
  ) {}

  onApplicationBootstrap(): void {
    const undeclared = this.routes().filter(
      (route) => !route.isPublic && route.permission === null,
    );
    if (undeclared.length > 0) {
      throw new Error(
        `Routes without @RequirePermission or @AllowAnonymous() (M02):\n` +
          undeclared
            .map((route) => `  - ${route.handler} (${route.path})`)
            .join('\n'),
      );
    }
  }

  routes(): RouteEntry[] {
    const routes: RouteEntry[] = [];

    for (const wrapper of this.discovery.getControllers()) {
      const { instance, metatype } = wrapper;
      if (!instance || !metatype) continue;
      const prototype = Object.getPrototypeOf(instance) as object;
      const controllerPath = String(
        Reflect.getMetadata(PATH_METADATA, metatype) ?? '',
      );

      for (const name of this.scanner.getAllMethodNames(prototype)) {
        const handler = (prototype as Record<string, unknown>)[name];
        if (typeof handler !== 'function') continue;
        // Only route handlers carry a request method.
        const method = Reflect.getMetadata(METHOD_METADATA, handler) as
          RequestMethod | undefined;
        if (method === undefined) continue;

        const targets = [handler, metatype];
        const isPublic =
          this.reflector.getAllAndOverride<boolean>(PUBLIC_METADATA, targets) ??
          false;
        const permission =
          this.reflector.getAllAndOverride<Permission | undefined>(
            PERMISSION_METADATA,
            targets,
          ) ?? null;
        const methodPath = String(
          Reflect.getMetadata(PATH_METADATA, handler) ?? '',
        );

        routes.push({
          handler: `${metatype.name}.${name}`,
          method: RequestMethod[method],
          path: joinPath(controllerPath, methodPath),
          permission,
          isPublic: Boolean(isPublic),
        });
      }
    }
    return routes;
  }
}
