import type {
  Account,
  Approval,
  AuditAction,
  CollectionListItem,
  CustomerSummary,
  DayCloseView,
  DayKind,
  DiscrepancyState,
  Handover,
  JuniorSync,
  ScheduleSlotView,
  SectorTally,
  SecurityEventKind,
  StaffSummary,
} from "@repo/contracts";
import { Badge, type BadgeProps } from "@repo/ui";

type Tone = NonNullable<BadgeProps["tone"]>;
type Entry = { label: string; tone: Tone };
type Table<Value extends string> = Record<Value, Entry>;

/**
 * Every status the console shows, and the tone it is shown in — one table, so
 * "Missed" is the same red on the day close, the account and the route
 * (design-system.md#colour). Keys are the contract's own enum values; adding
 * a value to a contract fails the type check here until it has a label.
 *
 * Tones are meaning, not decoration: `positive` is money that reconciled or a
 * record in good standing; `warning` waits on someone; `critical` is money
 * that did not arrive or a record that is barred; `info` is neither good nor
 * bad but worth noticing; `neutral` is settled history.
 */
export const STATUS = {
  /** Sectors and lines are deactivated, never deleted (M03). */
  activity: {
    active: { label: "Active", tone: "positive" },
    inactive: { label: "Inactive", tone: "neutral" },
  } satisfies Table<"active" | "inactive">,

  /** ACTIVE may sign in; SUSPENDED and INACTIVE may not (M01). */
  staff: {
    ACTIVE: { label: "Active", tone: "positive" },
    SUSPENDED: { label: "Suspended", tone: "warning" },
    INACTIVE: { label: "Inactive", tone: "neutral" },
  } satisfies Table<StaffSummary["status"]>,

  customer: {
    ACTIVE: { label: "Active", tone: "positive" },
    INACTIVE: { label: "Inactive", tone: "neutral" },
    BLACKLISTED: { label: "Blacklisted", tone: "critical" },
  } satisfies Table<CustomerSummary["status"]>,

  account: {
    PENDING: { label: "Pending", tone: "info" },
    ACTIVE: { label: "Active", tone: "positive" },
    COMPLETED: { label: "Completed", tone: "neutral" },
    DEFAULTED: { label: "Defaulted", tone: "critical" },
    WRITTEN_OFF: { label: "Written off", tone: "critical" },
  } satisfies Table<Account["status"]>,

  slot: {
    PENDING: { label: "Pending", tone: "neutral" },
    COLLECTED: { label: "Collected", tone: "positive" },
    PARTIAL: { label: "Partial", tone: "warning" },
    MISSED: { label: "Missed", tone: "critical" },
    CANCELLED: { label: "Cancelled", tone: "neutral" },
  } satisfies Table<ScheduleSlotView["status"]>,

  /** BR-08 variance classification. */
  classification: {
    CORRECT: { label: "Correct", tone: "positive" },
    LOW: { label: "Low", tone: "warning" },
    EXTRA: { label: "Extra", tone: "info" },
    NO_PAYMENT: { label: "No payment", tone: "critical" },
  } satisfies Table<CollectionListItem["classification"]>,

  /** An adjustment's state (US-044). An original is shown by classification. */
  correction: {
    PENDING_APPROVAL: {
      label: "Correction · awaiting approval",
      tone: "warning",
    },
    CONFIRMED: { label: "Correction · approved", tone: "neutral" },
    REJECTED: { label: "Correction · rejected", tone: "neutral" },
    REVERSED: { label: "Reversed", tone: "neutral" },
  } satisfies Table<CollectionListItem["status"]>,

  decision: {
    PENDING: { label: "Awaiting approval", tone: "warning" },
    APPROVED: { label: "Approved", tone: "positive" },
    REJECTED: { label: "Rejected", tone: "neutral" },
  } satisfies Table<Approval["decision"]>,

  day: {
    OPEN: { label: "Open", tone: "neutral" },
    CLOSED: { label: "Closed", tone: "warning" },
    REOPENED: { label: "Reopened", tone: "warning" },
    TALLIED: { label: "Tallied", tone: "positive" },
  } satisfies Table<DayCloseView["status"]>,

  /** A sector's day, rolled up from its lines' day closes (M11, §19). */
  sectorTally: {
    OPEN: { label: "Open", tone: "neutral" },
    CLOSED: { label: "Closed", tone: "warning" },
    TALLIED: { label: "Tallied", tone: "positive" },
    NO_COLLECTIONS: { label: "Nothing due", tone: "neutral" },
  } satisfies Table<SectorTally>,

  /** Whether collections are due on a line's day (M06): nothing to close on the others. */
  dayKind: {
    WORKING: { label: "Working day", tone: "neutral" },
    SUNDAY: { label: "Sunday", tone: "neutral" },
    HOLIDAY: { label: "Holiday", tone: "neutral" },
  } satisfies Table<DayKind["kind"]>,

  /** Whether a Junior's phone has sent everything for the day (US-060). */
  sync: {
    SENT: { label: "All sent", tone: "positive" },
    UNSENT: { label: "Not sent", tone: "warning" },
    NOT_HEARD: { label: "Not heard from", tone: "neutral" },
  } satisfies Table<JuniorSync["sync"]>,

  handover: {
    PENDING: { label: "Waiting", tone: "warning" },
    ACKNOWLEDGED: { label: "Acknowledged", tone: "positive" },
    DISPUTED: { label: "Disputed", tone: "critical" },
  } satisfies Table<Handover["status"]>,

  /**
   * How a Junior's cash for one line and day stands (BR-17, M12). `OVER` is
   * not good news and not bad news — money Rasi never recorded arrived — so it
   * is `info`, the same reading the handover screen gives it.
   */
  cash: {
    TALLIED: { label: "Tallied", tone: "positive" },
    SHORT: { label: "Short", tone: "critical" },
    OVER: { label: "Over", tone: "info" },
    AWAITING: { label: "Awaiting", tone: "warning" },
    DISPUTED: { label: "Disputed", tone: "critical" },
  } satisfies Table<DiscrepancyState>,

  auditAction: {
    CREATE: { label: "Created", tone: "positive" },
    UPDATE: { label: "Changed", tone: "info" },
    DELETE: { label: "Deleted", tone: "critical" },
    APPROVE: { label: "Approved", tone: "positive" },
    REJECT: { label: "Rejected", tone: "critical" },
    LOGIN: { label: "Sign-in", tone: "neutral" },
    REOPEN_DAY: { label: "Day reopened", tone: "warning" },
    EXPORT: { label: "Exported", tone: "neutral" },
  } satisfies Table<AuditAction>,

  /**
   * Why an attempt was refused (M13, ADR-0014). `critical` is someone reaching
   * past their role; `warning` is a rule that stopped them changing something
   * settled; `info` is an id that was not theirs, which is worth noticing
   * without being an accusation.
   */
  securityEvent: {
    PERMISSION_DENIED: { label: "Permission denied", tone: "critical" },
    RANK_GUARD: { label: "Role above their own", tone: "critical" },
    SELF_GUARD: { label: "Acting on themselves", tone: "warning" },
    SETTING_LOCKED: { label: "Locked setting", tone: "warning" },
    OUT_OF_SCOPE: { label: "Not theirs to open", tone: "info" },
  } satisfies Table<SecurityEventKind>,
} as const;

export type StatusKind = keyof typeof STATUS;
export type StatusValue<Kind extends StatusKind> = keyof (typeof STATUS)[Kind] &
  string;

export function statusLabel<Kind extends StatusKind>(
  kind: Kind,
  value: StatusValue<Kind>,
): string {
  return (STATUS[kind] as Table<string>)[value]?.label ?? value;
}

/**
 * `<StatusBadge kind="customer" value={customer.status} />`. `suffix` adds a
 * detail after the label ("· 3") without changing the tone.
 */
export function StatusBadge<Kind extends StatusKind>({
  kind,
  value,
  suffix,
  shape,
}: {
  kind: Kind;
  value: StatusValue<Kind>;
  suffix?: string;
  /** `pill` on a dashboard card (ADR-0015). */
  shape?: BadgeProps["shape"];
}) {
  const entry = (STATUS[kind] as Table<string>)[value];
  if (!entry) return <Badge shape={shape}>{value}</Badge>;
  return (
    <Badge tone={entry.tone} shape={shape}>
      {entry.label}
      {suffix ? ` ${suffix}` : ""}
    </Badge>
  );
}

/** Active or inactive, from the `isActive` flag sectors and lines carry. */
export function ActivityBadge({ isActive }: { isActive: boolean }) {
  return (
    <StatusBadge kind="activity" value={isActive ? "active" : "inactive"} />
  );
}

/** An active account that has passed its target date reads as overdue. */
export function AccountStatusBadge({
  account,
}: {
  account: Pick<Account, "status" | "isOverdue">;
}) {
  if (account.status === "ACTIVE" && account.isOverdue) {
    return <Badge tone="warning">Active · overdue</Badge>;
  }
  return <StatusBadge kind="account" value={account.status} />;
}

/** An original shows its classification; a correction shows its decision. */
export function CollectionEntryBadge({
  entry,
}: {
  entry: Pick<CollectionListItem, "entryType" | "classification" | "status">;
}) {
  return entry.entryType === "ORIGINAL" ? (
    <StatusBadge kind="classification" value={entry.classification} />
  ) : (
    <StatusBadge kind="correction" value={entry.status} />
  );
}
