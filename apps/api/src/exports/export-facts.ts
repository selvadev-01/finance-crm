import type { DayKind } from '@repo/contracts';

import { formatInstant } from './export-cells.js';

/**
 * Small pieces every builder uses to say what an export covers. Kept here so
 * a report and a dashboard word the same fact the same way.
 */

export type Fact = readonly [label: string, value: string];

/** Every export says what its amounts are. */
export const AMOUNTS_FACT: Fact = ['Amounts', 'Indian rupees (INR)'];

export function periodFact(from: string, to: string): Fact {
  return ['Period', from === to ? from : `${from} to ${to}`];
}

export function generatedFact(generatedAt: string): Fact {
  return ['Generated', formatInstant(generatedAt)];
}

/**
 * A filter the caller set, named from the rows when they carry the name; a
 * filter that matched nothing still says it was applied.
 */
export function filterFact(
  label: string,
  id: string | undefined,
  name: string | undefined,
): Fact[] {
  if (id === undefined) return [];
  return [[label, name ?? 'The one selected (no rows matched)']];
}

/** `NO_PAYMENT` → `No payment`. */
export function humanize(value: string): string {
  const words = value.toLowerCase().replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function dayLabel(day: DayKind): string {
  return day.kind === 'HOLIDAY'
    ? `Holiday: ${day.name}`
    : day.kind === 'SUNDAY'
      ? 'Sunday'
      : 'Working day';
}

/** `group ? read(group) : null` — a group that could not be read stays `null` (S-07). */
export function known<Group, Value>(
  group: Group | null | undefined,
  read: (group: Group) => Value,
): Value | null {
  return group === null || group === undefined ? null : read(group);
}

export function rangeStem(name: string, from: string, to: string): string {
  return from === to ? `rasi-${name}-${from}` : `rasi-${name}-${from}-to-${to}`;
}
