"use client";

import { createContext, use } from "react";

/**
 * Where a floating layer (popover, menu, combobox list) is mounted.
 *
 * Radix portals to `<body>` by default. Inside a `Dialog` that is wrong: the
 * native `showModal()` puts the dialog in the top layer and makes everything
 * outside it inert, so a list portalled to `<body>` would be drawn behind the
 * backdrop and ignore the pointer. `Dialog` provides its own `<dialog>`
 * element here, and every floating layer mounts into it (ADR-0013).
 */
export const PortalContainerContext = createContext<HTMLElement | null>(null);

export function usePortalContainer(): HTMLElement | undefined {
  return use(PortalContainerContext) ?? undefined;
}
