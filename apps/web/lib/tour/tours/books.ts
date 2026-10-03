import { AT, type ScreenTour, step } from "../content";

const booksTabs = step(
  AT.sectionTabs,
  ["The parts of the books", "Books-oda parts"],
  [
    "Summary, expenses, owner money and income, and profit — each a tab.",
    "Summary, expenses, owner money, income, profit — ovvonnum oru tab.",
  ],
);

const exportStep = step(
  AT.actions,
  ["Export", "Export"],
  [
    "Download this statement as Excel or PDF.",
    "Indha statement-a Excel-aa PDF-aa download pannalaam.",
  ],
);

export const BOOKS_TOURS: readonly ScreenTour[] = [
  {
    path: "/books",
    steps: [
      step(
        AT.header,
        ["The business's money", "Business-oda panam"],
        [
          "Where the money is right now — the business's own books, kept for you as collections and expenses happen.",
          "Ippo panam enga irukku nu inga paakalaam. Collections, expenses nadakkumbodhe books automatic-aa update aagum.",
        ],
      ),
      booksTabs,
      step(
        AT.stats,
        ["Where it is", "Panam enga irukku"],
        [
          "Cash in hand, cash still with the collection staff, money still to come from customers, and this month's profit.",
          "Kaila irukkura cash, collection staff kaila irukkura cash, customers-kitta irundhu varavendiyadhu, indha maasa profit.",
        ],
      ),
      step(
        undefined,
        ["Record money", "Panam record pannunga"],
        [
          "Add money when the owner puts capital in, Add expense for office spends, Other income for anything else that comes in, and Owner took money when the owner draws.",
          "Owner capital podumbodhu Add money, office selavu-ku Add expense, vera varumaanam-ku Other income, owner panam edutha Owner took money.",
        ],
      ),
    ],
  },
  {
    path: "/books/expenses",
    steps: [
      step(
        AT.header,
        ["Expenses", "Expenses"],
        [
          "Everything the business spends, from rent to the Juniors' petrol.",
          "Business selavu ellaam — rent-la irundhu Juniors petrol varaikkum.",
        ],
      ),
      step(
        AT.actions,
        ["Record an expense", "Expense record pannunga"],
        [
          "Choose its type, the amount, and whether it was paid from cash or the bank.",
          "Type, amount, cash-la kuduthom-aa bank-la kuduthom-aa nu choose pannunga.",
        ],
      ),
      step(
        AT.stats,
        ["This month", "Indha maasam"],
        [
          "Spent so far, what is waiting for approval, and the biggest type of expense.",
          "Ippo varaikkum selavu, approval-ku wait panradhu, adhigamaa selavaana type.",
        ],
      ),
      step(
        AT.filters,
        ["Find one", "Thedunga"],
        [
          "Filter by type, how it was paid, or status.",
          "Type, eppadi kuduthom, status vechu filter pannalaam.",
        ],
      ),
      step(
        AT.list,
        ["Every expense", "Ella expense-um"],
        [
          "Each spend with its date and who recorded it.",
          "Ovvoru selavum date-um yaar record pannaanga nu-um.",
        ],
      ),
    ],
  },
  {
    path: "/books/money",
    steps: [
      step(
        AT.header,
        ["Owner money and income", "Owner panam, income"],
        [
          "Money the owner puts in or takes out, and income that isn't a collection.",
          "Owner podra panam, edukkura panam, apram collection illaadha vera income.",
        ],
      ),
      step(
        AT.stats,
        ["The totals", "Mothamaa"],
        [
          "Other income and what the owner has taken out.",
          "Vera income evlo, owner evlo eduthaanga.",
        ],
      ),
      step(
        undefined,
        ["Only the owner", "Owner mattum dhaan"],
        [
          "Adding capital and recording a drawing are the owner's alone. An Admin can record other income.",
          "Capital podradhu, drawing record panradhu owner mattum dhaan pannalaam. Other income Admin-um record pannalaam.",
        ],
      ),
      booksTabs,
    ],
  },
  {
    path: "/books/profit-and-loss",
    steps: [
      step(
        AT.header,
        ["Profit and loss", "Laabam, nashtam"],
        [
          "Income less expenses: did the business make money?",
          "Income-la irundhu expenses kazhichaa — business-ku laabama nashtama?",
        ],
      ),
      step(
        AT.filters,
        ["The period", "Period"],
        [
          "This month, last month, or another period.",
          "Indha maasam, pona maasam, illa vera period.",
        ],
      ),
      step(
        undefined,
        ["Reading it", "Eppadi padikkanum"],
        [
          "Profit on collections comes in as each payment arrives, never all at once when the loan is made. Expenses come off it.",
          "Collections-la profit ovvoru payment varumbodhum konjam konjamaa varum — loan kudukkumbodhe motham varaadhu. Adhula irundhu expenses kazhiyum.",
        ],
      ),
      exportStep,
    ],
  },
  {
    path: "/books/balance-sheet",
    steps: [
      step(
        AT.header,
        ["Balance sheet", "Balance sheet"],
        [
          "What the business owns and owes on one date.",
          "Oru date-la business-ku enna irukku, enna kadan irukku.",
        ],
      ),
      step(
        AT.filters,
        ["As of", "Endha date"],
        [
          "Pick the date to see it as it stood then.",
          "Date choose panna andha naal nilamai theriyum.",
        ],
      ),
      exportStep,
    ],
  },
  {
    path: "/books/cash-book",
    steps: [
      step(
        AT.header,
        ["Cash book", "Cash book"],
        [
          "Every rupee in and out of cash, with the running balance.",
          "Cash-la ulla vandha, veliya pona ovvoru rupaai-um, running balance-oda.",
        ],
      ),
      step(
        AT.stats,
        ["Opening to closing", "Opening-la irundhu closing"],
        [
          "Opening balance, receipts, payments and closing balance for the period.",
          "Period-oda opening balance, receipts, payments, closing balance.",
        ],
      ),
      exportStep,
    ],
  },
  {
    path: "/books/journal",
    steps: [
      step(
        AT.header,
        ["Journal voucher", "Journal voucher"],
        [
          "For the rare entry nothing else records — adjustments your accountant asks for.",
          "Vera edhulayum record aagaadha entry-ku — accountant sollura adjustments maadhiri.",
        ],
      ),
      step(
        AT.actions,
        ["New voucher", "Pudhu voucher"],
        [
          "Debits must equal credits before it posts. Start from a template when one fits.",
          "Debit-um credit-um equal-aa irundhaa dhaan post aagum. Template irundha adhula irundhu start pannunga.",
        ],
      ),
    ],
  },
  {
    path: "/books/statements/[ledgerAccountId]",
    steps: [
      step(
        AT.header,
        ["Account statement", "Account statement"],
        [
          "Everything that moved through this one ledger account.",
          "Indha oru ledger account-la nadandha ellaamey.",
        ],
      ),
      step(
        AT.filters,
        ["The period", "Period"],
        [
          "Choose the dates; opening and closing follow.",
          "Dates choose pannunga — opening, closing adhukku ethha maadhiri maarum.",
        ],
      ),
      step(
        AT.stats,
        ["In and out", "Ulla, veliya"],
        [
          "Opening, receipts, payments and closing.",
          "Opening, receipts, payments, closing.",
        ],
      ),
      exportStep,
    ],
  },
];
