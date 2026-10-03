import { AT, type ScreenTour, step } from "../content";

const settingsTabs = step(
  AT.sectionTabs,
  ["All the settings", "Ella settings-um"],
  [
    "Each part of the settings is a tab. You see the ones your role may change.",
    "Settings-oda ovvoru part-um oru tab. Unga role maatha mudiyura tabs mattum theriyum.",
  ],
);

export const SETTINGS_TOURS: readonly ScreenTour[] = [
  {
    path: "/settings/business",
    steps: [
      step(
        AT.header,
        ["Business settings", "Business settings"],
        [
          "The rules Rasi runs your business by. Only the owner changes them.",
          "Rasi unga business-a nadathura rules. Owner mattum dhaan maathalaam.",
        ],
      ),
      settingsTabs,
      step(
        "main section",
        ["Change, or reset", "Maathunga, illa reset"],
        [
          "Change sets a new value; Reset goes back to Rasi's default. Some are fixed and can't change.",
          "Change-la pudhu value podalaam; Reset panna Rasi default-ku thirumbi pogum. Sila settings fixed — maatha mudiyaadhu.",
        ],
      ),
    ],
  },
  {
    path: "/settings/holidays",
    steps: [
      step(
        AT.header,
        ["Holidays", "Leave naatkal"],
        [
          "Days nobody collects. Schedules skip them, like Sundays.",
          "Collection illaadha naatkal. Sunday maadhiriye schedule-la idhu skip aagum.",
        ],
      ),
      settingsTabs,
      step(
        AT.actions,
        ["Add a holiday", "Holiday add pannunga"],
        [
          "Give the date and name, and whether it applies to the whole business or some sectors.",
          "Date, peru kudunga, full business-kaa illa sila sectors-kaa nu choose pannunga.",
        ],
      ),
      step(
        AT.list,
        ["Upcoming and past", "Varapodhu, pona"],
        [
          "Switch between upcoming and past holidays. Remove one that was added by mistake.",
          "Varapodhu, poanadhu rendaiyum maathi paakalaam. Thappaa add pannadha remove pannalaam.",
        ],
      ),
    ],
  },
  {
    path: "/settings/notifications",
    steps: [
      step(
        AT.header,
        ["Notifications", "Notifications"],
        [
          "How Rasi tells you things — on this device, and in which language.",
          "Rasi ungalukku eppadi sollanum — indha device-la, endha language-la.",
        ],
      ),
      settingsTabs,
      step(
        "main section",
        ["On this device", "Indha device-la"],
        [
          "Turn on alerts so approvals and handovers reach you even when Rasi is closed.",
          "Alerts on pannunga — Rasi close-aa irundhaalum approvals, handovers ungalukku varum.",
        ],
      ),
      step(
        undefined,
        ["Language and choices", "Language, choices"],
        [
          "Get notifications in English or Tamil, and choose which kinds you want.",
          "Notifications English-laiyo Tamil-laiyo vaangalaam, endha type venum nu-um choose pannalaam.",
        ],
      ),
    ],
  },
  {
    path: "/settings/templates",
    steps: [
      step(
        AT.header,
        ["Message templates", "Message templates"],
        [
          "The words Rasi uses in its notifications and emails. Change them to sound like your business.",
          "Rasi notifications, emails-la use panra words. Unga business style-ku maathikkalaam.",
        ],
      ),
      step(
        AT.list,
        ["Pick a message", "Oru message choose pannunga"],
        [
          "Open one to edit it in English and Tamil.",
          "Open panni English-laiyum Tamil-laiyum edit pannalaam.",
        ],
      ),
    ],
  },
  {
    path: "/settings/templates/[key]",
    steps: [
      step(
        AT.header,
        ["One message", "Oru message"],
        [
          "Change what this message says, and how it reaches people.",
          "Indha message enna sollanum, eppadi poi seranum nu maathalaam.",
        ],
      ),
      step(
        AT.tabs,
        ["English and Tamil", "English, Tamil"],
        [
          "Each language has its own words. Save each one separately.",
          "Ovvoru language-kum thani words. Thani thaniyaa save pannunga.",
        ],
      ),
      step(
        undefined,
        ["Preview first", "Mudhalla preview"],
        [
          "The preview shows it with real-looking details. “Use Rasi's words” puts the original back.",
          "Preview-la nijamaana details maadhiri kaatum. “Use Rasi's words” panna original thirumbi varum.",
        ],
      ),
    ],
  },
  {
    path: "/settings/audit",
    steps: [
      step(
        AT.header,
        ["Audit log", "Audit log"],
        [
          "Who did what, and when — every change that matters. Nothing here can be edited.",
          "Yaar enna pannaanga, eppo pannaanga — mukkiyamaana ella maatramum. Idha yaarum edit panna mudiyaadhu.",
        ],
      ),
      settingsTabs,
      step(
        AT.filters,
        ["Find an entry", "Entry-a thedunga"],
        [
          "Filter by action, record, staff member or dates.",
          "Action, record, staff, dates vechu filter pannalaam.",
        ],
      ),
    ],
  },
  {
    path: "/settings/security",
    steps: [
      step(
        AT.header,
        ["Refused attempts", "Thadutha muyarchigal"],
        [
          "Every time someone tried something their role doesn't allow.",
          "Oruthar avanga role-ku allowed illaadhadha try panna ovvoru thadavaiyum inga varum.",
        ],
      ),
      settingsTabs,
      step(
        AT.filters,
        ["Look for a pattern", "Pattern paarunga"],
        [
          "Filter by reason, staff member or dates. Many from one person is worth asking about.",
          "Reason, staff, dates vechu filter pannunga. Oruthare niraya thadavai try pannirundhaa avangakitta kekkanum.",
        ],
      ),
    ],
  },
  {
    path: "/settings/expense-categories",
    steps: [
      step(
        AT.header,
        ["Expense types", "Expense types"],
        [
          "The kinds of expense people choose from — petrol, rent, tea.",
          "Expense podumbodhu choose panra types — petrol, rent, tea maadhiri.",
        ],
      ),
      settingsTabs,
      step(
        AT.actions,
        ["Add a type", "Type add pannunga"],
        [
          "Add the ones your business uses; rename one if its name isn't clear.",
          "Unga business-ku venum aanadha add pannunga; peru clear-aa illana rename pannunga.",
        ],
      ),
    ],
  },
  {
    path: "/settings/bank-accounts",
    steps: [
      step(
        AT.header,
        ["Bank accounts", "Bank accounts"],
        [
          "The business's bank accounts, so expenses and receipts can be paid through them.",
          "Business-oda bank accounts — expenses, receipts bank vazhiyaa pannalaam.",
        ],
      ),
      settingsTabs,
      step(
        AT.actions,
        ["Add one", "Add pannunga"],
        [
          "A name and the last four digits are enough to tell them apart.",
          "Oru peru, last four digits — idhu podhum.",
        ],
      ),
    ],
  },
  {
    path: "/settings/jobs",
    steps: [
      step(
        AT.header,
        ["Scheduled jobs", "Scheduled jobs"],
        [
          "The work Rasi does by itself — sending notifications, emails and reminders — and when it last ran.",
          "Rasi thaanaave panra vela — notifications, emails, reminders anuppuradhu — kadaisiyaa eppo run aachu nu.",
        ],
      ),
      settingsTabs,
      step(
        undefined,
        ["Just to look at", "Paakka mattum"],
        [
          "Nothing to change here. If a job shows a failure, tell whoever looks after Rasi.",
          "Inga maatha onnum illa. Edhaavadhu job fail-nu kaatina, Rasi-a paathukkuravangakitta sollunga.",
        ],
      ),
    ],
  },
];
