import { AT, type ScreenTour, step } from "../content";

/**
 * The Junior's app is one page whose views are hashes; each view has its own
 * tour, and `/route` with no tour-specific hash gets the home tour.
 */
export const FIELD_TOURS: readonly ScreenTour[] = [
  {
    path: "/route",
    steps: [
      step(
        undefined,
        ["Your day's route", "Unga innaikku route"],
        [
          "This app works without signal. Everything you record is saved on the phone first and sent to the office when there's network.",
          "Indha app signal illaamalum work aagum. Neenga record panradhu ellaam mudhalla phone-la save aagum, network vandhadhum office-ku pogum.",
        ],
      ),
      step(
        AT.syncChip,
        ["Is my day safe?", "En data safe-aa?"],
        [
          "Green “All sent” means the office has everything. Amber shows how many are still only on this phone — tap it to send them.",
          "Green-la “All sent”-na office-ku ellaam poiduchu. Amber-la irundha innum phone-la mattum evlo irukku nu kaatum — tap panni send pannunga.",
        ],
      ),
      step(
        "#field-menu",
        ["Everything you do", "Neenga panra ellaam"],
        [
          "Collect, hand over cash, record an expense, sync, and see your customers and today's collections.",
          "Collect, cash handover, expense, sync, unga customers, innaikku collections — ellaam inga irundhu.",
        ],
      ),
      step(
        "#todays-route",
        ["Today's route", "Innaikku route"],
        [
          "Your customers in visiting order. Search or filter to-visit and done. Tap a customer to record their payment.",
          "Visiting order-la unga customers. Search pannalaam, to-visit / done filter pannalaam. Customer-a tap panni payment record pannunga.",
        ],
      ),
      step(
        AT.fieldNav,
        ["The bottom bar", "Keezha irukkura bar"],
        [
          "Home, Route, Cash, Sync and Profile — one tap away on every screen.",
          "Home, Route, Cash, Sync, Profile — endha screen-la irundhaalum oru tap dhaan.",
        ],
      ),
      step(
        AT.tour,
        ["Tour any screen", "Endha screen-kum tour"],
        [
          "Press this on any screen for its own tour.",
          "Endha screen-la venumnaalum idha press pannunga, andha screen-oda tour varum.",
        ],
      ),
    ],
  },
  {
    path: "/route",
    hash: "collect/",
    steps: [
      step(
        AT.fieldBar,
        ["At the customer's door", "Customer veettu vaasal-la"],
        [
          "Their name and address. Call them from here if they're not home.",
          "Avanga peru, address. Veetla illana inga irundhe call pannalaam.",
        ],
      ),
      step(
        '[data-testid^="collect-"]',
        ["What's due", "Evlo kodukkanum"],
        [
          "Each account shows what's expected today and what's outstanding. Type the amount you actually received — less or more is fine.",
          "Ovvoru account-layum innaikku expected, baakki evlo nu kaatum. Neenga nijamaa vaangina amount-a type pannunga — kammiyaa adhigamaa irundhaalum paravaillai.",
        ],
      ),
      step(
        AT.fieldAction,
        ["Confirm, or no payment", "Confirm, illa no payment"],
        [
          "Confirm saves it on the phone straight away. If they didn't pay, press “No payment — I visited” so the office knows you came.",
          "Confirm panna udane phone-la save aagum. Avanga kudukkalana “No payment — I visited” press pannunga — neenga vandheenga nu office-ku theriyum.",
        ],
      ),
    ],
  },
  {
    path: "/route",
    hash: "customer/",
    steps: [
      step(
        '[data-testid="portfolio-summary"]',
        ["Everything they owe", "Mothamaa baakki"],
        [
          "The total outstanding across all their accounts.",
          "Avanga ella accounts-um serthu evlo baakki nu.",
        ],
      ),
      step(
        '[data-testid^="portfolio-account-"]',
        ["Each account", "Ovvoru account-um"],
        [
          "How far each loan has come, with its bar.",
          "Ovvoru loan-um evlo mudinjirukku nu bar-la kaatum.",
        ],
      ),
      step(
        '[data-testid="portfolio-payments"]',
        ["Recent payments", "Recent payments"],
        [
          "What they paid lately — handy when a customer says “I already paid”.",
          "Samibathula evlo kuduthaanga — customer “naan already kuduthuten” sonna check panna use aagum.",
        ],
      ),
    ],
  },
  {
    path: "/route",
    hash: "customers",
    steps: [
      step(
        AT.fieldBar,
        ["Your line's customers", "Unga line customers"],
        [
          "Everyone on your line, not just today's.",
          "Unga line-la irukkura ellaarum — innaikku mattum illa.",
        ],
      ),
      step(
        "main input",
        ["Find someone", "Thedunga"],
        [
          "Search by name, code, street or mobile, or filter due today, overdue and completed.",
          "Peru, code, street, mobile vechu thedunga, illa due today, overdue, completed nu filter pannunga.",
        ],
      ),
      step(
        '[data-testid^="portfolio-"]',
        ["Open a customer", "Customer-a open pannunga"],
        [
          "See their accounts and payments, and record today's collection from there.",
          "Avanga accounts, payments paakalaam, anga irundhe innaikku collection record pannalaam.",
        ],
      ),
    ],
  },
  {
    path: "/route",
    hash: "collections",
    steps: [
      step(
        AT.fieldBar,
        ["Today's collections", "Innaikku collections"],
        [
          "Everything you recorded today, with your totals at the top.",
          "Innaikku neenga record panna ellaam, mela total-oda.",
        ],
      ),
      step(
        '[data-testid^="collection-"]',
        ["Each one", "Ovvonnum"],
        [
          "Each row is marked: still only on this phone, or already with the office. Tap one to open that customer.",
          "Ovvoru row-layum mark irukkum — innum phone-la mattum-aa, illa office-ku poiducha nu. Tap panna andha customer open aagum.",
        ],
      ),
      step(
        undefined,
        ["Typed the wrong amount?", "Amount thappaa pottuteengala?"],
        [
          "You can't edit a collection. Use “Ask to correct a collection” and your Senior approves the right amount.",
          "Collection-a edit panna mudiyaadhu. “Ask to correct a collection” use pannunga — unga Senior correct amount-a approve pannuvaanga.",
        ],
      ),
    ],
  },
  {
    path: "/route",
    hash: "handover",
    steps: [
      step(
        AT.fieldBar,
        ["Hand over the cash", "Cash-a handover pannunga"],
        [
          "At the end of the day, give the cash you collected to your Senior. This needs signal.",
          "Naal mudivula collect panna cash-a unga Senior-kitta kudunga. Idhukku signal venum.",
        ],
      ),
      step(
        '[data-testid^="cash-"]',
        ["Count the notes", "Notes-a enniyunga"],
        [
          "Enter how many of each note you have. If the total differs from what you collected, say why.",
          "Ovvoru note-um evlo irukku nu podunga. Collect pannadhukkum total-kum difference irundha kaaranam sollunga.",
        ],
      ),
      step(
        undefined,
        ["Spent some on the way?", "Vazhila selavu aachaa?"],
        [
          "Record a field expense first — petrol, for example — so the handover adds up once it's approved.",
          "Mudhalla field expense record pannunga — petrol maadhiri. Approve aanadhum handover correct-aa tally aagum.",
        ],
      ),
    ],
  },
  {
    path: "/route",
    hash: "sync",
    steps: [
      step(
        ['[data-testid="all-synced"]', '[data-testid="outbox"]'],
        ["What's on this phone", "Phone-la enna irukku"],
        [
          "Anything not yet at the office is listed here. When it's empty, everything is sent.",
          "Office-ku innum poagaadhadhu ellaam inga list aagum. Empty-aa irundha ellaam poiduchu.",
        ],
      ),
      step(
        undefined,
        ["Send now", "Ippove send pannunga"],
        [
          "It sends by itself when there's signal. Press Send now if you've just found network. Don't sign out while anything is unsent.",
          "Signal vandhaa thaanaave pogum. Ippo dhaan network kidaichadhu-na Send now press pannunga. Edhaavadhu send aagaama irundha sign out pannaadheenga.",
        ],
      ),
    ],
  },
  {
    path: "/route",
    hash: "correct",
    steps: [
      step(
        AT.fieldBar,
        ["Ask for a correction", "Correction kelunga"],
        [
          "Pick today's collection that was wrong, type what you actually collected and why. Your Senior decides.",
          "Thappaana innaikku collection-a choose pannunga, nijamaa evlo vaangineenga, edhukku nu type pannunga. Senior decide pannuvaanga.",
        ],
      ),
    ],
  },
  {
    path: "/route",
    hash: "expense",
    steps: [
      step(
        "main form",
        ["Field expense", "Field expense"],
        [
          "What it was for, the amount, and a note. It goes to your Senior for approval.",
          "Edhukku selavu, evlo, oru note. Senior approval-ku pogum.",
        ],
      ),
      step(
        undefined,
        ["After approval", "Approve aanadhum"],
        [
          "An approved expense comes off the cash you hand over, so your handover still adds up.",
          "Approve aana expense neenga handover panra cash-la irundhu kazhiyum, adhanaala handover tally aagum.",
        ],
      ),
    ],
  },
  {
    path: "/route",
    hash: "notifications",
    steps: [
      step(
        AT.fieldBar,
        ["Notifications", "Notifications"],
        [
          "Corrections decided, expenses approved, handovers acknowledged. Mark all read when you've seen them.",
          "Correction decide aanadhu, expense approve aanadhu, handover acknowledge aanadhu — ellaam inga. Paathadhum Mark all read pannunga.",
        ],
      ),
    ],
  },
  {
    path: "/route",
    hash: "profile",
    steps: [
      step(
        AT.fieldBar,
        ["You and this phone", "Neenga, indha phone"],
        [
          "Your line, your connection, what's still unsent and when the route was last saved.",
          "Unga line, connection, innum send aagaadhadhu, route kadaisiyaa eppo save aachu nu.",
        ],
      ),
      step(
        undefined,
        ["Password, language, sign out", "Password, language, sign out"],
        [
          "Change your password, choose the language of your notifications, or sign out — sign-out waits until everything is sent.",
          "Password maathalaam, notification language choose pannalaam, sign out pannalaam — ellaam send aana apram dhaan sign out aagum.",
        ],
      ),
    ],
  },
];
