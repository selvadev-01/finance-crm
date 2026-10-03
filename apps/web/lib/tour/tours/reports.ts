import { AT, type ScreenTour, step, type TourStepText } from "../content";

/** The filter bar and export every range report shares. */
function rangeReport(
  what: TourStepText,
  figures: readonly [en: string, ta: string],
  rows: readonly [en: string, ta: string],
): TourStepText[] {
  return [
    what,
    step(
      AT.filters,
      ["Dates and sector", "Dates, sector"],
      [
        "Choose the period and, if you like, one sector. The figures and rows below follow.",
        "Period-a choose pannunga, venum-na oru sector mattum. Keezha irukkura figures, rows ellaam adhukku ethha maadhiri maarum.",
      ],
    ),
    step(AT.stats, ["The totals", "Mothamaa"], figures),
    step(AT.list, ["The detail", "Vivaramaa"], rows),
    step(
      AT.actions,
      ["Export", "Export"],
      [
        "Download exactly what you see, as Excel or PDF.",
        "Screen-la paakkuradha appadiye Excel-aa PDF-aa download pannalaam.",
      ],
    ),
  ];
}

export const REPORTS_TOURS: readonly ScreenTour[] = [
  {
    path: "/reports",
    steps: [
      step(
        AT.header,
        ["Reports", "Reports"],
        [
          "Every report in one place. A Senior's reports cover their own line only.",
          "Ella report-um oru idathula. Senior-ku avanga line-ku mattum dhaan report.",
        ],
      ),
      step(
        undefined,
        ["Which one?", "Edha paakanum?"],
        [
          "Line-wise and Collection for the day's work, Overdue for late loans, Discrepancies for cash differences, Investment for money lent and returned.",
          "Daily vela-ku Line-wise, Collection. Late aana loans-ku Overdue. Cash difference-ku Discrepancies. Kudutha panam, thirumbi vandha panam-ku Investment.",
        ],
      ),
    ],
  },
  {
    path: "/reports/line-wise",
    steps: rangeReport(
      step(
        AT.header,
        ["Line-wise report", "Line-wise report"],
        [
          "Each line's staff, customers, accounts and collections over a period.",
          "Oru period-la ovvoru line-oda staff, customers, accounts, collections.",
        ],
      ),
      [
        "Expected, collected, still pending, and extra across the lines shown.",
        "Kaatura lines ellaam serthu expected, collected, pending, extra.",
      ],
      [
        "One row per line. A low line stands out against its expected.",
        "Oru line-ku oru row. Expected-a vida kammiyaa irukkura line udane theriyum.",
      ],
    ),
  },
  {
    path: "/reports/collection",
    steps: rangeReport(
      step(
        AT.header,
        ["Collection report", "Collection report"],
        [
          "What was collected against what was due, with every entry marked tallied, short or extra.",
          "Due-ku evlo collect aachu, ovvoru entry-um tally-aa, kammiyaa, extra-vaa nu mark pannirukkum.",
        ],
      ),
      [
        "Expected, collected, pending and extra for the period.",
        "Indha period-ku expected, collected, pending, extra.",
      ],
      [
        "Each collection with its class. Filter by class or by who collected to find a pattern.",
        "Ovvoru collection-um adhoda class-oda. Class illa yaar collect pannaanga nu filter panni pattern kandupidikkalaam.",
      ],
    ),
  },
  {
    path: "/reports/overdue",
    steps: [
      step(
        AT.header,
        ["Overdue accounts", "Overdue accounts"],
        [
          "Loans still being collected after their target date.",
          "Target date thaandiyum innum collect aagittu irukkura loans.",
        ],
      ),
      step(
        AT.filters,
        ["How late", "Evlo late"],
        [
          "Show accounts overdue by at least so many days, and order them.",
          "Evlo naal late aana accounts-nu choose panni, order pannalaam.",
        ],
      ),
      step(
        AT.stats,
        ["The size of it", "Evlo periya vishayam"],
        [
          "How many accounts, the total outstanding and the longest overdue.",
          "Evlo accounts, mothamaa baakki evlo, romba late aanadhu evlo naal.",
        ],
      ),
      step(
        AT.list,
        ["Follow them up", "Follow up pannunga"],
        [
          "Open an account to see its schedule and who collects it.",
          "Account-a open panna schedule-um yaar collect panraanga nu-um theriyum.",
        ],
      ),
    ],
  },
  {
    path: "/reports/discrepancy",
    steps: rangeReport(
      step(
        AT.header,
        ["Cash discrepancies", "Cash difference"],
        [
          "Cash recorded at the door against cash handed over, by line, day and Junior.",
          "Vaasal-la record pannadhu vs handover pannadhu — line, naal, Junior vaariyaa.",
        ],
      ),
      [
        "Collected, handed over, and how much came short or over.",
        "Collect aanadhu, handover aanadhu, evlo kammi, evlo adhigam.",
      ],
      [
        "Each difference. A Junior who is often short is worth a conversation.",
        "Ovvoru difference-um. Adikkadi kammiyaa varra Junior-kitta pesanum.",
      ],
    ),
  },
  {
    path: "/reports/investment",
    steps: rangeReport(
      step(
        AT.header,
        ["Investment overview", "Investment overview"],
        [
          "What each line was lent and what has come back.",
          "Ovvoru line-kum evlo kadan kuduthom, evlo thirumbi vandhuchu.",
        ],
      ),
      [
        "Invested, returned, profit earned and accounts disbursed.",
        "Invest, return, profit, evlo accounts disburse aachu.",
      ],
      [
        "One row per line, so you can see where the money works best.",
        "Oru line-ku oru row — endha line-la panam nalla work aagudhu nu theriyum.",
      ],
    ),
  },
  {
    path: "/reports/trial-balance",
    steps: [
      step(
        AT.header,
        ["Trial balance", "Trial balance"],
        [
          "Every ledger account's balance. Debits and credits must be equal.",
          "Ella ledger account-oda balance. Debit-um credit-um equal-aa irukkanum.",
        ],
      ),
      step(
        AT.filters,
        ["As of a date", "Oru date varaikkum"],
        [
          "See the balances as they stood on any day.",
          "Endha naal-la eppadi irundhuchu nu paakalaam.",
        ],
      ),
      step(
        AT.list,
        ["The accounts", "Accounts"],
        [
          "Open an account for its statement.",
          "Account-a open panna adhoda statement varum.",
        ],
      ),
      step(
        AT.actions,
        ["Postings", "Postings"],
        [
          "View postings lists every entry behind these balances.",
          "View postings-la indha balance-ku pinnaadi irukkura ella entry-um theriyum.",
        ],
      ),
    ],
  },
  {
    path: "/reports/trial-balance/postings",
    steps: [
      step(
        AT.header,
        ["Ledger postings", "Ledger postings"],
        [
          "Every double-entry posting, debit and credit together.",
          "Ella double-entry posting-um, debit-um credit-um serthu.",
        ],
      ),
      step(
        AT.filters,
        ["Dates and kind", "Dates, vagai"],
        [
          "Narrow to a period or one kind — collections, disbursements, expenses.",
          "Oru period, illa oru vagai mattum — collections, disbursements, expenses.",
        ],
      ),
    ],
  },
];
