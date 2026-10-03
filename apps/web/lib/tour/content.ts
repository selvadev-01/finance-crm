/**
 * What a tour says, in both languages side by side, so a step can never
 * exist in one and be missing from the other.
 *
 * `ta` is Tanglish: Tamil in English letters, the way a coworker explains a
 * screen over your shoulder — English for the words people say in English at
 * work (customer, line, collection, approve), Tamil for the rest.
 */
export interface Said {
  en: string;
  ta: string;
}

export interface TourStepText {
  target?: string | readonly string[];
  title: Said;
  body: Said;
}

export interface ScreenTour {
  /**
   * The route it explains, with `[param]` for any one segment:
   * `/customers/[customerId]`. The field app's views add a `hash`.
   */
  path: string;
  hash?: string;
  steps: readonly TourStepText[];
}

/** The parts of a page the shared building blocks mark with `data-tour`. */
export const AT = {
  header: '[data-tour="page-header"]',
  actions: '[data-tour="page-actions"]',
  summary: '[data-tour="page-summary"]',
  filters: '[data-tour="filters"]',
  list: '[data-tour="list"]',
  stats: '[data-tour="stats"]',
  tabs: '[data-tour="tabs"]',
  sectionTabs: '[data-tour="section-tabs"]',
  form: "main form",
  // The frame.
  sidebar: ["#console-sidebar", '[data-tour="menu"]', '[data-tour="tabbar"]'],
  tabbar: '[data-tour="tabbar"]',
  search: '[data-tour="search"]',
  bell: '[data-tour="bell"]',
  account: '[data-tour="account"]',
  tour: '[data-tour="tour"]',
  // The field app.
  fieldBar: '[data-testid="status-bar"]',
  syncChip: '[data-tour="sync-chip"]',
  fieldBell: '[data-testid="bell"]',
  fieldNav: 'nav[aria-label="Field app"]',
  fieldAction: '[data-tour="field-action"]',
} as const;

/** One step, written inline: `step(AT.list, ["Title", "Thalaippu"], ["…", "…"])`. */
export function step(
  target: TourStepText["target"],
  title: readonly [en: string, ta: string],
  body: readonly [en: string, ta: string],
): TourStepText {
  return {
    target,
    title: { en: title[0], ta: title[1] },
    body: { en: body[0], ta: body[1] },
  };
}
