import { AT, type ScreenTour, step } from "../content";

export const RECORDS_TOURS: readonly ScreenTour[] = [
  {
    path: "/customers",
    steps: [
      step(
        AT.header,
        ["Customers", "Customers"],
        [
          "Everyone who borrows from the business. A Senior sees the customers on their own line.",
          "Business-la kadan vaangina ellaarum inga irukkaanga. Senior-ku avanga line customers mattum theriyum.",
        ],
      ),
      step(
        AT.actions,
        ["Add a customer", "Pudhu customer"],
        [
          "New customer opens the onboarding form. Add the customer first, then open their account.",
          "New customer click panna form varum. Mudhalla customer-a add pannunga, apram dhaan account open pannanum.",
        ],
      ),
      step(
        AT.filters,
        ["Search", "Thedunga"],
        [
          "Search by name, code or mobile number.",
          "Peru, code, illa mobile number vechu thedunga.",
        ],
      ),
      step(
        AT.list,
        ["Open a customer", "Customer-a open pannunga"],
        [
          "Each row opens the customer's page: their accounts, payments and references.",
          "Row-a click panna customer page varum — accounts, payments, reference ellaam anga.",
        ],
      ),
    ],
  },
  {
    path: "/customers/new",
    steps: [
      step(
        AT.header,
        ["New customer", "Pudhu customer"],
        [
          "Fill this in once, when someone first borrows from you.",
          "Oruthar mudhal thadavai kadan vaangumbodhu idha oru thadavai fill pannunga.",
        ],
      ),
      step(
        AT.form,
        ["Their details and line", "Details, line"],
        [
          "Name, mobile and address, and the line whose Junior will visit them. If the mobile is already used, you'll be warned before saving.",
          "Peru, mobile, address, apram endha line Junior avangala visit pannuvaanga nu choose pannunga. Mobile already irundha save panradhukku munnaadi warning varum.",
        ],
      ),
      step(
        undefined,
        ["Reference persons", "Reference persons"],
        [
          "Someone who knows the customer — it can be an existing customer. Add as many as you like.",
          "Customer-a theriyum aana oruthar — already irukkura customer-aa kooda irukkalaam. Evlo venum naalum add pannalaam.",
        ],
      ),
      step(
        undefined,
        ["Save, then open an account", "Save panni, account open pannunga"],
        [
          "Save customer takes you to their page. “Save and add another” is quicker when you have a pile of forms.",
          "Save customer panna avanga page-ku poidum. Niraya forms irundha “Save and add another” fast-aa irukkum.",
        ],
      ),
    ],
  },
  {
    path: "/customers/[customerId]",
    steps: [
      step(
        AT.header,
        ["One customer", "Oru customer"],
        [
          "Their name, code and status at the top.",
          "Mela avanga peru, code, status.",
        ],
      ),
      step(
        AT.actions,
        ["Transfer or edit", "Transfer, edit"],
        [
          "Transfer moves them to another line — their accounts go with them. Edit changes their details.",
          "Transfer panna vera line-ku maathalaam — accounts-um koodave pogum. Edit-la details maathalaam.",
        ],
      ),
      step(
        AT.tabs,
        ["Four views", "Naalu tabs"],
        [
          "Portfolio is the money summary, Profile their details and history, Accounts each loan, Collections every payment.",
          "Portfolio-la panam summary, Profile-la details, Accounts-la ovvoru loan-um, Collections-la ella payment-um.",
        ],
      ),
      step(
        AT.stats,
        ["Where they stand", "Ippo nilamai"],
        [
          "Collected, invested, profit, missed days and when they last paid.",
          "Evlo collect aachu, evlo invest, profit, evlo naal miss aachu, kadaisiyaa eppo kuduthaanga.",
        ],
      ),
    ],
  },
  {
    path: "/customers/[customerId]/edit",
    steps: [
      step(
        AT.form,
        ["Change their details", "Details maathunga"],
        [
          "Fix a name, number or address, or change their status. Their accounts and payments are not touched.",
          "Peru, number, address thiruthalaam, status maathalaam. Accounts, payments onnum maaradhu.",
        ],
      ),
      step(
        undefined,
        ["Line changes are transfers", "Line maathanum-na transfer"],
        [
          "To move them to another line, use Transfer on their page, so the history is kept.",
          "Vera line-ku maathanum-na avanga page-la Transfer use pannunga — appo dhaan history save aagum.",
        ],
      ),
    ],
  },
  {
    path: "/accounts/new",
    steps: [
      step(
        AT.header,
        ["New account", "Pudhu account"],
        ["A new loan for this customer.", "Indha customer-ku pudhu loan."],
      ),
      step(
        AT.form,
        ["The terms", "Terms"],
        [
          "Account amount is what they pay back in total; invested is what they receive. Choose daily or weekly and the disbursement date.",
          "Account amount-na avanga mothamaa thirumbi kudukkuradhu; invested-na avangalukku kudukkuradhu. Daily-aa weekly-aa, eppo kudukkareenga nu choose pannunga.",
        ],
      ),
      step(
        AT.list,
        ["Check the schedule", "Schedule-a check pannunga"],
        [
          "Every collection day and amount, skipping Sundays and holidays. Read it before saving.",
          "Ovvoru collection naal-um amount-um — Sunday, holiday skip aagum. Save panradhukku munnaadi oru thadavai paarunga.",
        ],
      ),
      step(
        undefined,
        ["Pending or disbursed", "Pending-aa, disburse-aa"],
        [
          "Save as pending if the money isn't paid yet. Save and disburse when the cash goes out today. Mid-term is for a loan that started before Rasi.",
          "Panam innum kudukkalana Save as pending. Innaikke cash kudukkureenga-na Save and disburse. Rasi-ku munnaadiye start aana loan-ku mid-term.",
        ],
      ),
    ],
  },
  {
    path: "/accounts/[accountId]",
    steps: [
      step(
        AT.header,
        ["One loan", "Oru loan"],
        [
          "The account code and whether it is pending, active or closed.",
          "Account code, apram pending-aa, active-aa, closed-aa nu status.",
        ],
      ),
      step(
        AT.stats,
        ["The money", "Panam vivaram"],
        [
          "Amount, invested, profit, collected so far and what is still outstanding.",
          "Amount, invest, profit, ippo varaikkum collect aanadhu, innum baakki evlo.",
        ],
      ),
      step(
        AT.actions,
        ["What you can do", "Enna pannalaam"],
        [
          "A pending account can have its terms corrected, then be disbursed. Only the owner disburses or closes an account.",
          "Pending account-oda terms-a correct pannalaam, apram disburse pannalaam. Disburse, close rendum owner mattum dhaan pannalaam.",
        ],
      ),
      step(
        AT.list,
        ["Schedule and history", "Schedule, history"],
        [
          "Each due day with what was paid, and below it everything that ever happened to this account.",
          "Ovvoru due naal-um evlo kuduthaanga nu, keezha indha account-la nadandha ellaamey.",
        ],
      ),
    ],
  },
  {
    path: "/lines",
    steps: [
      step(
        AT.header,
        ["Lines", "Lines"],
        [
          "A line is one Junior's daily round of customers. A Senior sees their own line here.",
          "Line-na oru Junior daily poga vendiya customers round. Senior-ku avanga line mattum theriyum.",
        ],
      ),
      step(
        AT.actions,
        ["New line", "Pudhu line"],
        [
          "Create a line inside a sector. It gets its code automatically.",
          "Oru sector-kulla pudhu line create pannunga. Code automatic-aa varum.",
        ],
      ),
      step(
        AT.filters,
        ["By sector", "Sector vaariyaa"],
        [
          "Show the lines of one sector, or include inactive ones.",
          "Oru sector-oda lines mattum, illa inactive lines-um serthu paakalaam.",
        ],
      ),
      step(
        AT.list,
        ["Open a line", "Line-a open pannunga"],
        [
          "Its staff, visiting order, today's money and day closes.",
          "Adhoda staff, visiting order, innaikku panam, day close — ellaam anga.",
        ],
      ),
    ],
  },
  {
    path: "/lines/[lineId]",
    steps: [
      step(
        AT.header,
        ["One line", "Oru line"],
        [
          "Everything about this round. Day close, rename and deactivate are at the top.",
          "Indha round pathi ellaam. Day close, rename, deactivate mela irukku.",
        ],
      ),
      step(
        AT.stats,
        ["Who works it", "Yaar paakkuraanga"],
        [
          "The Senior and Juniors responsible today, and how many customers it has. Add Junior assigns someone.",
          "Innaikku poruppaana Senior, Juniors, evlo customers. Add Junior-la oruthara assign pannalaam.",
        ],
      ),
      step(
        AT.filters,
        ["Assignments over time", "Yaar eppo irundhaanga"],
        [
          "Who was responsible on any date — useful when checking an old day.",
          "Endha naal-la yaar poruppu nu paakalaam — pazhaya naal check panna use aagum.",
        ],
      ),
      step(
        '[data-testid="visiting-order"]',
        ["Visiting order", "Visiting order"],
        [
          "Use the up and down arrows to put customers in the order the Junior walks the street, then Save order. Their phone follows it.",
          "Junior street-la poara order-la customers-a up, down arrows vechu arrange panni Save order pannunga. Avanga phone-um adhe order-la kaatum.",
        ],
      ),
    ],
  },
  {
    path: "/lines/[lineId]/day-closes/[businessDate]",
    steps: [
      step(
        AT.header,
        ["Close the day", "Day close"],
        [
          "At the end of the day, check the line and close it. Change the date to see another day.",
          "Naal mudivula line-a check panni close pannunga. Vera naal paakka date maathunga.",
        ],
      ),
      step(
        AT.stats,
        ["Does it add up?", "Tally aagudha?"],
        [
          "Expected, collected and the cash actually received. They should match before you close.",
          "Expected, collected, kaila vandha cash — close panradhukku munnaadi moonum match aaganum.",
        ],
      ),
      step(
        AT.list,
        ["Juniors and exceptions", "Juniors, exceptions"],
        [
          "Each Junior's day, and anything that needs a look — unvisited customers, unsent entries, open corrections.",
          "Ovvoru Junior-oda naal, apram gavanikka vendiyadhu — visit pannaadha customers, send aagaadha entries, open corrections.",
        ],
      ),
      step(
        AT.actions,
        ["Close, or reopen", "Close, illa reopen"],
        [
          "Close day marks unvisited customers as missed. A closed day can be reopened, with a reason.",
          "Close day panna visit pannaadha customers missed-nu aagum. Close aana naal-a reason kuduthu reopen pannalaam.",
        ],
      ),
    ],
  },
  {
    path: "/sectors",
    steps: [
      step(
        AT.header,
        ["Sectors", "Sectors"],
        [
          "A sector is an area — a group of lines.",
          "Sector-na oru area — konja lines serndha group.",
        ],
      ),
      step(
        AT.actions,
        ["New sector, compare", "Pudhu sector, compare"],
        [
          "Create a sector, or compare how the sectors are doing today.",
          "Pudhu sector create pannunga, illa innaikku sectors eppadi poguthu nu compare pannunga.",
        ],
      ),
      step(
        AT.list,
        ["Open a sector", "Sector-a open pannunga"],
        [
          "See its lines and add new ones.",
          "Adhoda lines paakalaam, pudhusaa add pannalaam.",
        ],
      ),
    ],
  },
  {
    path: "/sectors/[sectorId]",
    steps: [
      step(
        AT.header,
        ["One sector", "Oru sector"],
        [
          "Rename or deactivate the sector from the top.",
          "Mela irundhu sector-a rename, deactivate pannalaam.",
        ],
      ),
      step(
        AT.list,
        ["Its lines", "Idhoda lines"],
        [
          "Every line in this sector. New line adds one here.",
          "Indha sector-la irukkura ella lines-um. New line-la pudhusaa serkkalaam.",
        ],
      ),
    ],
  },
  {
    path: "/team",
    steps: [
      step(
        AT.header,
        ["Team", "Team"],
        [
          "Everyone who works in the business. A Senior sees their line's team.",
          "Business-la vela paakkura ellaarum. Senior-ku avanga line team mattum.",
        ],
      ),
      step(
        AT.actions,
        ["Add staff", "Staff add pannunga"],
        [
          "Creates their login and shows a temporary password once — give it to them; they change it at first sign-in.",
          "Avangalukku login create aagum, temporary password oru thadavai mattum kaatum — adha avangakitta kudunga, first sign-in-la avanga maathiduvaanga.",
        ],
      ),
      step(
        AT.filters,
        ["By role or status", "Role, status vaariyaa"],
        [
          "Show only Juniors, or only suspended staff, for example.",
          "Udhaaranathukku Juniors mattum, illa suspend aanavanga mattum paakalaam.",
        ],
      ),
      step(
        AT.list,
        ["Open someone", "Oruthara open pannunga"],
        [
          "Their details, role, line assignments, and password reset.",
          "Avanga details, role, line assignment, password reset ellaam anga.",
        ],
      ),
    ],
  },
  {
    path: "/team/[staffProfileId]",
    steps: [
      step(
        AT.header,
        ["One staff member", "Oru staff"],
        ["Their name, role and status.", "Avanga peru, role, status."],
      ),
      step(
        AT.actions,
        ["Manage them", "Manage pannunga"],
        [
          "Edit details, change role, reset a forgotten password, suspend, or mark as left. Assign to a line puts them on a round.",
          "Details edit, role maathu, marandha password reset, suspend, illa left-nu mark pannalaam. Assign to a line-la oru round-ku podalaam.",
        ],
      ),
      step(
        AT.list,
        ["Assignment history", "Assignment history"],
        [
          "Every line they've been responsible for, and when.",
          "Avanga endha line-la eppo poruppaa irundhaanga nu full history.",
        ],
      ),
    ],
  },
];
