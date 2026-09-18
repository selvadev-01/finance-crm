import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * tailwind-merge only knows Tailwind's default scales. Without these, a role
 * size such as `text-label` reads as a text *colour* and silently removes the
 * `text-ink` beside it. Keep in step with the `@theme` block in theme.css.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ["display", "title", "heading", "body", "label", "caption", "2xs"],
      shadow: ["raised", "popover", "overlay"],
      radius: ["control", "surface", "overlay", "pill"],
    },
  },
});

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
