"use client";

import { Compass } from "@phosphor-icons/react/dist/ssr";
import { AppShell, cn, Tour, type TourLabels } from "@repo/ui";
import { useState } from "react";

import { tourFor, type ScreenTour } from "./tours";
import { type TourLanguage, useTourLanguage } from "./language";

const LABELS: Record<TourLanguage, TourLabels> = {
  en: {
    back: "Back",
    next: "Next",
    done: "Got it",
    close: "Close tour",
    progress: (step, total) => `Step ${step} of ${total}`,
  },
  tanglish: {
    back: "Back",
    next: "Next",
    done: "Purinjidhu!",
    close: "Tour-a close pannunga",
    progress: (step, total) => `${step} / ${total}`,
  },
};

const BUTTON_LABEL: Record<TourLanguage, string> = {
  en: "Tour of this screen",
  tanglish: "Indha screen tour",
};

/**
 * Starts the tour of whatever screen is open — only when pressed. Which tour
 * is read at the press, from the path and (in the field app) the hash, so
 * one button in the frame serves every screen under it.
 *
 * `look` places it: the computer layout's top bar, the phone layout's app
 * bar, or the field app's bar. The sign-in screens have no tour.
 */
export function TourButton({
  look,
}: {
  look: "topbar" | "appbar" | "field";
}) {
  const [language] = useTourLanguage();
  const [tour, setTour] = useState<ScreenTour | null>(null);
  const label = BUTTON_LABEL[language];

  function start() {
    setTour(tourFor(window.location.pathname, window.location.hash));
  }

  const button =
    look === "topbar" || look === "appbar" ? (
      <AppShell.TopbarAction label={label} icon={<Compass aria-hidden />}>
        <button type="button" data-tour="tour" onClick={start} />
      </AppShell.TopbarAction>
    ) : (
      <button
        type="button"
        data-tour="tour"
        onClick={start}
        aria-label={label}
        className="flex size-12 shrink-0 items-center justify-center rounded-pill text-ink hover:bg-surface-sunken"
      >
        <Compass aria-hidden size={24} />
      </button>
    );

  return (
    <>
      {button}
      {tour ? (
        <ScreenTourView tour={tour} onClose={() => setTour(null)} />
      ) : null}
    </>
  );
}

function ScreenTourView({
  tour,
  onClose,
}: {
  tour: ScreenTour;
  onClose: () => void;
}) {
  const [language] = useTourLanguage();
  const steps = tour.steps.map((step) => ({
    target: step.target,
    title: language === "en" ? step.title.en : step.title.ta,
    body: language === "en" ? step.body.en : step.body.ta,
  }));
  return (
    <Tour
      steps={steps}
      labels={LABELS[language]}
      aside={<LanguageSwitch />}
      onClose={onClose}
    />
  );
}

/** English or Tanglish, switched mid-tour without losing the place. */
function LanguageSwitch() {
  const [language, setLanguage] = useTourLanguage();
  const options: { value: TourLanguage; label: string }[] = [
    { value: "en", label: "English" },
    { value: "tanglish", label: "Tanglish" },
  ];
  return (
    <span
      role="group"
      aria-label="Tour language"
      className="flex rounded-pill border border-border bg-surface-sunken p-0.5"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={language === option.value}
          onClick={() => setLanguage(option.value)}
          className="rounded-pill px-2.5 py-1 text-caption font-medium text-ink-muted transition-colors hover:text-ink aria-pressed:bg-surface-raised aria-pressed:text-ink aria-pressed:shadow-raised"
        >
          {option.label}
        </button>
      ))}
    </span>
  );
}
