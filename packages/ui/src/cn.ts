import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge class names, with later Tailwind utilities winning over earlier ones.
 *
 * Plain string concatenation does not work with Tailwind: `"p-2 p-4"` leaves
 * both in the class list and the winner is whichever CSS rule happens to come
 * later in the stylesheet, not the one the caller intended.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
