"use client";

import {
  type KeyboardEvent,
  type PointerEvent,
  useId,
  useRef,
  useState,
} from "react";

import {
  axisTicks,
  monotonePath,
  niceCeiling,
  plotFraction,
  toPaise,
} from "./chart-scale";
import { cn } from "./cn";

/**
 * A money series over days (ADR-0015): the dashboards' trend. Hand-drawn SVG,
 * not a chart library — a library would need every amount as a `number`.
 * Values arrive as decimal strings and become plot fractions only through
 * `chart-scale.ts`; every label and the tooltip format the original strings.
 *
 * One series is drawn as an `area` (a 3px accent line over a fading fill),
 * others as dashed `line`s. The chart is an image with a summary for a screen
 * reader, a table of every point behind it, and a keyboard cursor: focus the
 * plot and use ←/→ (Home/End) to read one day at a time.
 */

export interface AreaChartSeries {
  id: string;
  label: string;
  variant: "area" | "line";
}

export interface AreaChartPoint {
  /** The x value's key — a business date. */
  key: string;
  /** Each series' value, a decimal string. */
  values: Record<string, string>;
}

interface AreaChartProps {
  /** Names the chart: "Collected against expected, last 30 working days". */
  label: string;
  series: readonly AreaChartSeries[];
  points: readonly AreaChartPoint[];
  /** An amount for the axis and the tooltip — `formatCurrency`. */
  formatValue: (value: string) => string;
  /** A short x label for the axis — "5 Jan". */
  formatKey: (key: string) => string;
  /** The x value in full, for the tooltip and the table — "Mon 5 Jan 2026". */
  formatKeyLong?: (key: string) => string;
  className?: string;
}

const WIDTH = 600;
const HEIGHT = 200;
/** Headroom above the ceiling, so the top line is not clipped. */
const TOP = 6;
/** Axis labels shown along the bottom, at most. */
const X_LABELS = 6;

/**
 * Every `every`-th day gets a label, and the last day always does — so the
 * one before it is dropped when the two would crowd each other.
 */
function showKeyLabel(index: number, count: number, every: number): boolean {
  const last = count - 1;
  if (index === last) return true;
  return index % every === 0 && last - index >= Math.ceil(every / 2);
}

/**
 * On a phone the axis has half the room, so every other label is dropped —
 * never the first or the last, and never the one crowding the last.
 */
export function keptOnPhone(position: number, count: number): boolean {
  const last = count - 1;
  if (position === 0 || position === last) return true;
  return position % 2 === 0 && position !== last - 1;
}

export function AreaChart({
  label,
  series,
  points,
  formatValue,
  formatKey,
  formatKeyLong = formatKey,
  className,
}: AreaChartProps) {
  const gradientId = `area-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const plotRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<number | null>(null);

  const paise = points.map((point) =>
    Object.fromEntries(
      series.map((line) => [line.id, toPaise(point.values[line.id] ?? "0")]),
    ),
  );
  const max = paise.reduce(
    (highest, values) =>
      Object.values(values).reduce(
        (top, value) => (value > top ? value : top),
        highest,
      ),
    0n,
  );
  const ceiling = niceCeiling(max);
  const ticks = axisTicks(ceiling);

  const xOf = (index: number) =>
    points.length <= 1 ? WIDTH / 2 : (index / (points.length - 1)) * WIDTH;
  const yOf = (value: bigint) =>
    HEIGHT - plotFraction(value, ceiling) * (HEIGHT - TOP);
  const pathOf = (id: string) =>
    monotonePath(
      paise.map((values, index) => ({ x: xOf(index), y: yOf(values[id]!) })),
    );
  const area = series.find((line) => line.variant === "area");

  const labelEvery = Math.max(1, Math.ceil(points.length / X_LABELS));
  const labelled = points.flatMap((_, index) =>
    showKeyLabel(index, points.length, labelEvery) ? [index] : [],
  );
  const shown = active === null ? null : points[active];

  const pick = (event: PointerEvent<HTMLDivElement>) => {
    const box = plotRef.current?.getBoundingClientRect();
    if (!box || box.width === 0 || points.length === 0) return;
    const ratio = (event.clientX - box.left) / box.width;
    const index = Math.round(ratio * (points.length - 1));
    setActive(Math.max(0, Math.min(points.length - 1, index)));
  };

  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const last = points.length - 1;
    if (last < 0) return;
    const next = {
      ArrowRight: Math.min(last, (active ?? -1) + 1),
      ArrowLeft: Math.max(0, (active ?? last + 1) - 1),
      Home: 0,
      End: last,
    }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    setActive(next);
  };

  const describe = (index: number) => {
    const point = points[index]!;
    return `${formatKeyLong(point.key)}: ${series
      .map(
        (line) => `${line.label} ${formatValue(point.values[line.id] ?? "0")}`,
      )
      .join(", ")}`;
  };

  return (
    <figure className={cn("flex flex-col gap-3", className)}>
      <div className="grid grid-cols-[auto_1fr] gap-x-3">
        {/* The value axis, top to bottom. */}
        <div
          aria-hidden
          className="flex h-48 flex-col-reverse justify-between py-0 text-right text-2xs text-ink-subtle sm:h-56"
          data-numeric
        >
          {ticks.map((tick) => (
            <span key={tick} className="-my-2 leading-4">
              {formatValue(tick).replace(/\.00$/, "")}
            </span>
          ))}
        </div>

        <div
          ref={plotRef}
          role="img"
          aria-label={`${label}. ${
            points.length > 0 ? describe(points.length - 1) : "No days"
          }. Focus and use the arrow keys to read each day.`}
          tabIndex={0}
          onKeyDown={move}
          onPointerMove={pick}
          onPointerLeave={() => setActive(null)}
          onBlur={() => setActive(null)}
          className="relative h-48 rounded-control outline-offset-4 sm:h-56"
        >
          <svg
            aria-hidden
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            preserveAspectRatio="none"
            className="absolute inset-0 h-full w-full overflow-visible"
          >
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="0%"
                  className="[stop-color:var(--color-accent)]"
                  stopOpacity={0.4}
                />
                <stop
                  offset="95%"
                  className="[stop-color:var(--color-accent)]"
                  stopOpacity={0.05}
                />
              </linearGradient>
            </defs>
            {ticks.map((tick) => {
              const y = yOf(toPaise(tick));
              return (
                <line
                  key={tick}
                  x1={0}
                  x2={WIDTH}
                  y1={y}
                  y2={y}
                  strokeDasharray="4 4"
                  vectorEffect="non-scaling-stroke"
                  className="stroke-border"
                />
              );
            })}
            {area && points.length > 1 ? (
              <path
                d={`${pathOf(area.id)} L${WIDTH},${HEIGHT} L0,${HEIGHT} Z`}
                fill={`url(#${gradientId})`}
              />
            ) : null}
            {series.map((line) => (
              <path
                key={line.id}
                d={pathOf(line.id)}
                fill="none"
                vectorEffect="non-scaling-stroke"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={line.variant === "area" ? 3 : 1.5}
                strokeDasharray={line.variant === "line" ? "6 5" : undefined}
                className={
                  line.variant === "area"
                    ? "stroke-accent"
                    : "stroke-ink-subtle"
                }
              />
            ))}
          </svg>

          {shown && active !== null ? (
            <>
              <span
                aria-hidden
                className="absolute inset-y-0 w-px bg-border-strong/50"
                style={{ left: `${(xOf(active) / WIDTH) * 100}%` }}
              />
              {series.map((line) => (
                <span
                  key={line.id}
                  aria-hidden
                  className={cn(
                    "absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-pill border-2 border-surface-raised",
                    line.variant === "area" ? "bg-accent" : "bg-ink-subtle",
                  )}
                  style={{
                    left: `${(xOf(active) / WIDTH) * 100}%`,
                    top: `${(yOf(paise[active]![line.id]!) / HEIGHT) * 100}%`,
                  }}
                />
              ))}
              <div
                aria-hidden
                className={cn(
                  "pointer-events-none absolute top-0 z-10 flex min-w-40 flex-col gap-1 rounded-control border border-border bg-surface-overlay px-3 py-2 text-caption shadow-popover",
                  active > (points.length - 1) / 2
                    ? "-translate-x-[calc(100%+0.75rem)]"
                    : "translate-x-3",
                )}
                style={{ left: `${(xOf(active) / WIDTH) * 100}%` }}
              >
                <span className="font-medium text-ink">
                  {formatKeyLong(shown.key)}
                </span>
                {series.map((line) => (
                  <span
                    key={line.id}
                    className="flex items-center justify-between gap-4 text-ink-muted"
                  >
                    <span className="flex items-center gap-1.5">
                      <span
                        className={cn(
                          "size-2 rounded-pill",
                          line.variant === "area"
                            ? "bg-accent"
                            : "bg-ink-subtle",
                        )}
                      />
                      {line.label}
                    </span>
                    <span className="text-ink" data-numeric>
                      {formatValue(shown.values[line.id] ?? "0")}
                    </span>
                  </span>
                ))}
              </div>
            </>
          ) : null}
        </div>

        {/* The day axis. */}
        <div aria-hidden />
        <div aria-hidden className="relative mt-2 h-4 text-2xs text-ink-subtle">
          {labelled.map((index, position) => {
            const point = points[index]!;
            return (
              <span
                key={point.key}
                className={cn(
                  "absolute whitespace-nowrap",
                  index === 0
                    ? "translate-x-0"
                    : index === points.length - 1
                      ? "-translate-x-full"
                      : "-translate-x-1/2",
                  !keptOnPhone(position, labelled.length) && "hidden sm:block",
                )}
                style={{ left: `${(xOf(index) / WIDTH) * 100}%` }}
              >
                {formatKey(point.key)}
              </span>
            );
          })}
        </div>
      </div>

      <figcaption className="flex flex-wrap items-center gap-x-4 gap-y-1 text-caption text-ink-muted">
        {series.map((line) => (
          <span key={line.id} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className={cn(
                "inline-block w-4",
                line.variant === "area"
                  ? "h-[3px] rounded-pill bg-accent"
                  : "border-t-[1.5px] border-dashed border-ink-subtle",
              )}
            />
            {line.label}
          </span>
        ))}
      </figcaption>

      <p aria-live="polite" className="sr-only">
        {active === null ? "" : describe(active)}
      </p>

      {/*
       * Hidden in a wrapper, not on the table: a table ignores `width: 1px`
       * and grows to its content, which pushed a 360px page 26px wide.
       */}
      <div className="sr-only">
        <table>
          <caption>{label}</caption>
          <thead>
            <tr>
              <th scope="col">Day</th>
              {series.map((line) => (
                <th key={line.id} scope="col">
                  {line.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {points.map((point) => (
              <tr key={point.key}>
                <th scope="row">{formatKeyLong(point.key)}</th>
                {series.map((line) => (
                  <td key={line.id}>
                    {formatValue(point.values[line.id] ?? "0")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
