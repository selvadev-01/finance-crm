/**
 * The regression journey's business: a small daily-collection finance house in
 * Chennai, Tamil Nadu. Rasi has no structured address — a sector and a line
 * carry only a code and a name, a customer one free-text address — so the
 * India → Chennai → area hierarchy is carried like this:
 *
 * - organization — the finance house;
 * - sector — a Chennai zone (North, South);
 * - line — an area within the zone (Royapuram, Mylapore, …);
 * - customer address — door number, street, area, Chennai, PIN, Tamil Nadu.
 *
 * Every code, email and mobile is derived from the run id, so each run is a
 * new business that collides with no earlier one. Mobiles pass
 * `mobileSchema`: ten digits starting 6–9.
 */

export type LineKey = "tondiarpet" | "royapuram" | "mylapore" | "adyar";
export type SectorKey = "north" | "south";

export interface StaffSeed {
  name: string;
  email: string;
  phone: string;
}

export interface CustomerSeed {
  key: string;
  name: string;
  mobile: string;
  address: string;
  line: LineKey;
  notes?: string;
  references: { name: string; mobile: string; relation: string }[];
  accounts: AccountSeed[];
}

export interface AccountSeed {
  key: string;
  accountAmount: string;
  investedAmount: string;
  dailyAmount: string;
  termDays: string;
  /**
   * `disburse` — "Save and disburse" today; `pending` — "Save as pending";
   * `mid-term` — disbursed on the previous working day with nothing collected
   * yet (US-030a). "Collected to date" covers today, so its first remaining
   * slot is tomorrow and it is not on today's route.
   */
  kind: "disburse" | "pending" | "mid-term";
}

/** What the Junior does at the door, for each Royapuram account. */
export interface Visit {
  account: string;
  /** `null` = never visited, so day close marks the slot MISSED. */
  amount: string | "NO_PAYMENT" | null;
}

export function chennaiDataset(runId: string) {
  // ddhhmmss: unique per run within a month; the leading digit keeps staff,
  // customers and references apart.
  const tail = runId.slice(-8);
  const mobile = (lead: "6" | "7" | "8" | "9", index: number) =>
    `${lead}${tail}${index}`;
  const email = (who: string) =>
    `regression-${who}-${runId}@regression.rasi.test`;

  const organizationName = `Sri Kamakshi Finance — Regression ${runId}`;

  /** The business's owner: the Super Admin the journey starts from. */
  const owner: StaffSeed = {
    name: "Rajeshwari Natarajan",
    email: email("owner"),
    phone: mobile("6", 3),
  };
  const admin: StaffSeed = {
    name: "Lakshmi Krishnan",
    email: email("admin"),
    phone: mobile("6", 0),
  };
  const senior: StaffSeed = {
    name: "Murugan Subramaniam",
    email: email("senior"),
    phone: mobile("6", 1),
  };
  const junior: StaffSeed = {
    name: "Selvi Manikandan",
    email: email("junior"),
    phone: mobile("6", 2),
  };

  // Codes are issued by the API (US-010, US-011), so only names are given here.
  const sectors: Record<SectorKey, { name: string }> = {
    north: { name: "Chennai North" },
    south: { name: "Chennai South" },
  };

  const lines: Record<LineKey, { sector: SectorKey; name: string }> = {
    tondiarpet: { sector: "north", name: "Tondiarpet" },
    royapuram: { sector: "north", name: "Royapuram" },
    mylapore: { sector: "south", name: "Mylapore" },
    adyar: { sector: "south", name: "Adyar" },
  };

  const customers: CustomerSeed[] = [
    // Royapuram — the line the Senior and the Junior work today.
    {
      key: "anbu",
      name: "Anbu Selvan",
      mobile: mobile("9", 0),
      address: "12, Kalmandapam Road, Royapuram, Chennai – 600013, Tamil Nadu",
      line: "royapuram",
      notes: "Runs a tea stall near the fishing harbour.",
      references: [
        {
          name: "Senthil Selvan",
          mobile: mobile("8", 0),
          relation: "Brother",
        },
      ],
      accounts: [
        {
          key: "anbu-1",
          accountAmount: "10000",
          investedAmount: "8500",
          dailyAmount: "100",
          termDays: "100",
          kind: "disburse",
        },
      ],
    },
    {
      key: "meenakshi",
      name: "Meenakshi Sundaram",
      mobile: mobile("9", 1),
      address:
        "4/27, Suriya Narayana Chetty Street, Royapuram, Chennai – 600013, Tamil Nadu",
      line: "royapuram",
      references: [
        {
          name: "Sundaram Pillai",
          mobile: mobile("8", 1),
          relation: "Husband",
        },
        {
          name: "Revathi Kumar",
          mobile: mobile("8", 2),
          relation: "Neighbour",
        },
      ],
      accounts: [
        {
          key: "meenakshi-1",
          accountAmount: "5000",
          investedAmount: "4250",
          dailyAmount: "50",
          termDays: "100",
          kind: "disburse",
        },
      ],
    },
    {
      key: "karthik",
      name: "Karthik Raja",
      mobile: mobile("9", 2),
      address: "88, Mint Street, Royapuram, Chennai – 600013, Tamil Nadu",
      line: "royapuram",
      notes: "Vegetable wholesale, closed on market holidays.",
      references: [
        { name: "Raja Gopal", mobile: mobile("8", 3), relation: "Father" },
      ],
      accounts: [
        {
          key: "karthik-1",
          accountAmount: "20000",
          investedAmount: "17000",
          dailyAmount: "200",
          termDays: "100",
          kind: "disburse",
        },
      ],
    },
    // US-042: one customer, two accounts, each recorded separately.
    {
      key: "kavitha",
      name: "Kavitha Rajan",
      mobile: mobile("9", 3),
      address:
        "15, West Madha Church Street, Royapuram, Chennai – 600013, Tamil Nadu",
      line: "royapuram",
      references: [
        { name: "Rajan Iyer", mobile: mobile("8", 4), relation: "Husband" },
      ],
      accounts: [
        {
          key: "kavitha-1",
          accountAmount: "10000",
          investedAmount: "8500",
          dailyAmount: "100",
          termDays: "100",
          kind: "disburse",
        },
        {
          key: "kavitha-2",
          accountAmount: "15000",
          investedAmount: "12750",
          dailyAmount: "150",
          termDays: "100",
          kind: "disburse",
        },
      ],
    },
    // US-030a: brought over from the paper ledger mid-term.
    {
      key: "murugesan",
      name: "Murugesan Pillai",
      mobile: mobile("9", 4),
      address:
        "3, Ibrahim Sahib Street, Royapuram, Chennai – 600013, Tamil Nadu",
      line: "royapuram",
      references: [
        {
          name: "Valli Murugesan",
          mobile: mobile("8", 5),
          relation: "Wife",
        },
      ],
      accounts: [
        {
          key: "murugesan-1",
          accountAmount: "10000",
          investedAmount: "8500",
          dailyAmount: "100",
          termDays: "100",
          kind: "mid-term",
        },
      ],
    },
    // Due today, but Selvi does not reach her: day close marks it MISSED.
    {
      key: "devi",
      name: "Devi Lakshmanan",
      mobile: mobile("9", 8),
      address: "7, Solaiappan Street, Royapuram, Chennai – 600013, Tamil Nadu",
      line: "royapuram",
      references: [
        {
          name: "Lakshmanan Chettiar",
          mobile: mobile("8", 9),
          relation: "Father",
        },
      ],
      accounts: [
        {
          key: "devi-1",
          accountAmount: "10000",
          investedAmount: "8500",
          dailyAmount: "100",
          termDays: "100",
          kind: "disburse",
        },
      ],
    },
    // Other lines — outside the Senior's and the Junior's scope.
    {
      key: "ganesh",
      name: "Ganesh Babu",
      mobile: mobile("9", 5),
      address: "21, T.H. Road, Tondiarpet, Chennai – 600081, Tamil Nadu",
      line: "tondiarpet",
      references: [
        { name: "Babu Rao", mobile: mobile("8", 6), relation: "Father" },
      ],
      accounts: [
        {
          key: "ganesh-1",
          accountAmount: "10000",
          investedAmount: "8500",
          dailyAmount: "100",
          termDays: "100",
          kind: "disburse",
        },
      ],
    },
    {
      key: "priya",
      name: "Priya Venkatesan",
      mobile: mobile("9", 6),
      address: "9, Luz Church Road, Mylapore, Chennai – 600004, Tamil Nadu",
      line: "mylapore",
      references: [
        {
          name: "Venkatesan Iyengar",
          mobile: mobile("8", 7),
          relation: "Father",
        },
      ],
      accounts: [
        {
          key: "priya-1",
          accountAmount: "5000",
          investedAmount: "4250",
          dailyAmount: "50",
          termDays: "100",
          kind: "pending",
        },
      ],
    },
    {
      key: "saravanan",
      name: "Saravanan Murthy",
      mobile: mobile("9", 7),
      address:
        "42, Gandhi Nagar 2nd Main Road, Adyar, Chennai – 600020, Tamil Nadu",
      line: "adyar",
      references: [
        {
          name: "Deepa Saravanan",
          mobile: mobile("8", 8),
          relation: "Wife",
        },
      ],
      accounts: [],
    },
  ];

  /**
   * Royapuram at the door. Collected: 100 + 30 + 0 + 100 + 150 = 380, and
   * Meenakshi's 30 is corrected to 40 (she paid 40; Selvi typed 30), so the
   * cash to hand over is 390 against 700 expected (Devi's 100 unvisited).
   * Murugesan's mid-term account is not due until tomorrow.
   */
  const visits: Visit[] = [
    { account: "anbu-1", amount: "100" },
    { account: "meenakshi-1", amount: "30" },
    { account: "karthik-1", amount: "NO_PAYMENT" },
    { account: "kavitha-1", amount: "100" },
    { account: "kavitha-2", amount: "150" },
    { account: "devi-1", amount: null },
  ];
  /** On the line, but not on today's route. */
  const notDueToday = ["murugesan-1"];
  const correction = {
    account: "meenakshi-1",
    customerName: "Meenakshi Sundaram",
    correctedAmount: "40",
    reason: "Customer paid ₹40; I typed ₹30 in the rain.",
  };
  /** ₹390 as counted: 1 × 200, 1 × 100, 1 × 50, 2 × 20. */
  const handoverCounts: [denomination: number, count: number][] = [
    [200, 1],
    [100, 1],
    [50, 1],
    [20, 2],
  ];

  return {
    organizationName,
    owner,
    admin,
    senior,
    junior,
    sectors,
    lines,
    customers,
    visits,
    notDueToday,
    correction,
    handoverCounts,
    expected: {
      expectedTotal: "700.00",
      collectedTotal: "390.00",
      /** Outstanding after the day, per account. */
      outstanding: {
        "anbu-1": "9900.00",
        "meenakshi-1": "4960.00",
        "karthik-1": "20000.00",
        "kavitha-1": "9900.00",
        "kavitha-2": "14850.00",
        "murugesan-1": "10000.00",
        "devi-1": "10000.00",
        "ganesh-1": "10000.00",
      } as Record<string, string>,
    },
  };
}

export type ChennaiDataset = ReturnType<typeof chennaiDataset>;
