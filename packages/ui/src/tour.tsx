"use client";

import { ArrowLeft, ArrowRight, X } from "@phosphor-icons/react/dist/ssr";
import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { Button } from "./button";
import { cn } from "./cn";

/**
 * A guided walk through one screen, started by the person — never on its own.
 * Each step lights up one part of the page and explains it in a card beside
 * it; a step with no `target` (or whose target is not on this page right now)
 * floats in the middle or is skipped.
 *
 * The page underneath cannot be clicked while the tour is open: it explains,
 * it does not drive. Escape closes; ← and → step.
 *
 *   <Tour
 *     steps={[{ target: '[data-tour="filters"]', title: "Filters", body: "…" }]}
 *     labels={{ back: "Back", next: "Next", done: "Done", close: "Close tour",
 *               progress: (step, total) => `${step} of ${total}` }}
 *     aside={<LanguageSwitch />}
 *     onClose={() => setTouring(false)}
 *   />
 */
export interface TourStep {
  /**
   * Where the step points: a selector, or several tried in order — the first
   * one on screen wins, so a step can name its place in both layouts.
   * Without one, the card sits in the middle of the screen.
   */
  target?: string | readonly string[];
  title: string;
  body: ReactNode;
}

export interface TourLabels {
  back: string;
  next: string;
  done: string;
  close: string;
  progress: (step: number, total: number) => string;
}

export interface TourProps {
  steps: readonly TourStep[];
  labels: TourLabels;
  onClose: () => void;
  /** Beside the step count — the language switch. */
  aside?: ReactNode;
}

/** The first element a target names that is actually drawn. */
export function findTourTarget(target: TourStep["target"]): HTMLElement | null {
  if (!target) return null;
  const selectors = typeof target === "string" ? [target] : target;
  for (const selector of selectors) {
    for (const element of document.querySelectorAll<HTMLElement>(selector)) {
      const box = element.getBoundingClientRect();
      if (box.width > 0 && box.height > 0) return element;
    }
  }
  return null;
}

const GAP = 12;
const EDGE = 12;
const CARD_WIDTH = 352;
const HALO = 6;
/** The least space beside the lit part that a card fits in. */
const ROOM = 180;

export function Tour({ steps, labels, onClose, aside }: TourProps) {
  // Which steps this page can show, decided once when the tour opens: a step
  // whose part is not on screen (a role without the button, an empty list) is
  // left out rather than pointing at nothing.
  const [usable] = useState(() =>
    steps.flatMap((step, index) =>
      !step.target || findTourTarget(step.target) ? [index] : [],
    ),
  );
  const [position, setPosition] = useState(0);
  const [tracked, setTracked] = useState<{
    position: number;
    box: DOMRect;
  } | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const bodyId = useId();

  const total = usable.length;
  const step = total > 0 ? steps[usable[position] ?? 0] : undefined;
  const target = step?.target;
  const last = position >= total - 1;

  // Follow the lit element as the page scrolls or reflows.
  useEffect(() => {
    const element = findTourTarget(target);
    if (!element) return;
    const reduced =
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    element.scrollIntoView({
      block: "center",
      inline: "nearest",
      behavior: reduced ? "auto" : "smooth",
    });
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() =>
        setTracked({ position, box: element.getBoundingClientRect() }),
      );
    };
    measure();
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
      observer.disconnect();
    };
  }, [position, target]);

  // Focus moves into the card, and back to whatever opened the tour after.
  useEffect(() => {
    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    cardRef.current?.focus();
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  useEffect(() => {
    if (total === 0) onClose();
  }, [total, onClose]);

  if (!step) return null;

  const box = tracked?.position === position ? tracked.box : null;
  const next = () => (last ? onClose() : setPosition(position + 1));
  const back = () => setPosition(Math.max(0, position - 1));

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      next();
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      back();
    } else if (event.key === "Tab") {
      keepFocusInside(event, cardRef.current);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50" data-testid="tour">
      {/* The page stays visible but cannot be pressed through. */}
      <div aria-hidden className="absolute inset-0" />
      {box ? (
        <div
          aria-hidden
          className="pointer-events-none fixed rounded-surface shadow-[0_0_0_200vmax_color-mix(in_oklab,var(--color-ink)_50%,transparent)] outline-2 outline-offset-2 outline-accent transition-[top,left,width,height] duration-200 ease-out motion-reduce:transition-none"
          style={{
            top: box.top - HALO,
            left: box.left - HALO,
            width: box.width + HALO * 2,
            height: box.height + HALO * 2,
          }}
        />
      ) : (
        <div aria-hidden className="absolute inset-0 bg-ink/50" />
      )}

      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        // Not drawn until the lit part is measured, so it never jumps there
        // from the middle of the screen.
        className={cn(
          "fixed flex flex-col gap-3 overflow-y-auto rounded-overlay border border-border bg-surface-raised p-4 text-ink shadow-overlay outline-none",
          !box && target && "invisible",
        )}
        style={placeCard(box, Boolean(target))}
      >
        <div className="flex items-center gap-2">
          <span
            className="text-caption font-medium text-ink-muted"
            data-numeric
          >
            {labels.progress(position + 1, total)}
          </span>
          <span className="ml-auto flex items-center">{aside}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label={labels.close}
            className="-m-1 rounded-control p-1.5 text-ink-muted hover:bg-surface-sunken hover:text-ink"
          >
            <X aria-hidden size={18} />
          </button>
        </div>

        <div
          key={usable[position]}
          className="flex flex-col gap-1.5 animate-in"
        >
          <h2 id={titleId} className="text-heading text-ink">
            {step.title}
          </h2>
          <div id={bodyId} className="text-body text-ink-muted">
            {step.body}
          </div>
        </div>
        {/* A screen reader hears each new step, not only the first. */}
        <p className="sr-only" aria-live="polite">
          {labels.progress(position + 1, total)}: {step.title}
        </p>

        <div className="flex items-center gap-2 pt-1">
          <span aria-hidden className="flex flex-1 items-center gap-1">
            {usable.map((index, at) => (
              <span
                key={index}
                className={cn(
                  "h-1.5 rounded-pill transition-[width,background-color] duration-200 motion-reduce:transition-none",
                  at === position ? "w-4 bg-accent" : "w-1.5 bg-border-strong",
                )}
              />
            ))}
          </span>
          {position > 0 ? (
            <Button tone="ghost" size="sm" onClick={back}>
              <ArrowLeft aria-hidden size={16} />
              {labels.back}
            </Button>
          ) : null}
          <Button tone="primary" size="sm" onClick={next}>
            {last ? labels.done : labels.next}
            {last ? null : <ArrowRight aria-hidden size={16} />}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Below the lit part when there is more room there, above it otherwise; in
 * the middle when the step points at nothing. A part taller than the screen
 * leaves room on neither side, so the card sits at the foot of the screen
 * over it. Never wider or taller than the screen.
 */
function placeCard(box: DOMRect | null, pointed: boolean) {
  const width = Math.min(CARD_WIDTH, window.innerWidth - EDGE * 2);
  if (!box || !pointed) {
    return {
      width,
      top: "50%",
      left: "50%",
      transform: "translate(-50%, -50%)",
      maxHeight: `calc(100dvh - ${EDGE * 2}px)`,
    };
  }
  const left = Math.min(
    Math.max(box.left, EDGE),
    window.innerWidth - width - EDGE,
  );
  const below = window.innerHeight - box.bottom - HALO - GAP - EDGE;
  const above = box.top - HALO - GAP - EDGE;
  if (Math.max(below, above) < ROOM) {
    return {
      width,
      left,
      bottom: EDGE,
      maxHeight: `calc(60dvh - ${EDGE}px)`,
    };
  }
  return below >= above
    ? {
        width,
        left,
        top: box.bottom + HALO + GAP,
        maxHeight: Math.max(below, 160),
      }
    : {
        width,
        left,
        bottom: window.innerHeight - box.top + HALO + GAP,
        maxHeight: Math.max(above, 160),
      };
}

function keepFocusInside(
  event: KeyboardEvent<HTMLDivElement>,
  card: HTMLDivElement | null,
) {
  if (!card) return;
  const focusable = card.querySelectorAll<HTMLElement>(
    "button:not([disabled]), select, [href], input, [tabindex]:not([tabindex='-1'])",
  );
  const first = focusable[0];
  const final = focusable[focusable.length - 1];
  if (!first || !final) return;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    final.focus();
  } else if (!event.shiftKey && document.activeElement === final) {
    event.preventDefault();
    first.focus();
  }
}
