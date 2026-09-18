"use client";

import { Slot as RadixSlot } from "radix-ui";

/**
 * Merges its props onto its single child. It is how a component lets a caller
 * supply the element (`asChild`) — a Next `Link`, say — without `@repo/ui`
 * importing Next.
 */
export const Slot = RadixSlot.Slot;
