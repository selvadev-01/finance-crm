import { AT, type ScreenTour, step } from "../content";

/** The frame around every console page, introduced once on the dashboard. */
const frame = [
  step(
    AT.sidebar,
    ["Getting around", "Oru page-la irundhu innoru page"],
    [
      "Every area is here: today's money at the top, records like customers and lines below, settings last. You only see the areas your role can use.",
      "Ella area-um inga dhaan: mela innaikku panam sambandhamaanadhu, keezha customers, lines maadhiri records, kadaisila settings. Unga role-ku allowed aanadhu mattum dhaan theriyum.",
    ],
  ),
  step(
    AT.search,
    ["Find anything", "Edhaiyum thedalaam"],
    [
      "Search a customer, account, line or staff member by name, code or mobile. Ctrl K opens it from anywhere.",
      "Customer, account, line, staff — peru, code, illa mobile number vechu thedunga. Endha page-la irundhaalum Ctrl K press panna open aagum.",
    ],
  ),
  step(
    AT.bell,
    ["Notifications", "Notifications"],
    [
      "Approvals waiting, handovers, missed days — the count shows what you haven't read. Open one to go straight to it.",
      "Approval waiting, handover, missed days — ellaam inga varum. Count-la padikkaadha notifications theriyum. Click panna nera andha page-ku poidum.",
    ],
  ),
  step(
    AT.account,
    ["You and this device", "Neenga, indha device"],
    [
      "Your profile, the layout for this device, installing Rasi, and signing out.",
      "Unga profile, indha device-oda layout, Rasi install panradhu, sign out — ellaam inga irukku.",
    ],
  ),
  step(
    AT.tour,
    ["Tour any screen", "Endha screen-kum tour"],
    [
      "Each screen has its own tour. Press this whenever something is new — in English or Tanglish.",
      "Ovvoru screen-kum thani tour irukku. Edhaavadhu pudhusaa irundha idha press pannunga — English-laiyo Tanglish-laiyo.",
    ],
  ),
];

export const OPERATE_TOURS: readonly ScreenTour[] = [
  {
    path: "/dashboard",
    steps: [
      step(
        AT.header,
        ["Your day at a glance", "Innaikku nilavaram oru paarvaila"],
        [
          "This page fits your role: the owner sees the whole business, an Admin today's operations across lines, a Senior their own line.",
          "Indha page unga role-ku ethha maadhiri maarum: owner-ku full business, Admin-ku ella lines-oda innaikku vela, Senior-ku avanga line mattum.",
        ],
      ),
      step(
        AT.actions,
        ["Another day, or a copy", "Vera naal, illa copy"],
        [
          "Change the date to look back at an earlier day. Export gives you the same figures in Excel or PDF.",
          "Date-a maathi munnaadi naal-a paakalaam. Export press panna idhe figures Excel-laiyo PDF-laiyo kidaikkum.",
        ],
      ),
      step(
        AT.stats,
        ["Today's figures", "Innaikku figures"],
        [
          "Collected against expected, what is pending and what came in extra. Red means it needs a look.",
          "Expected-ku evlo collect aachu, evlo pending, evlo extra vandhuchu — ellaam inga. Red-la irundha konjam gavanikanum.",
        ],
      ),
      step(
        AT.list,
        ["Line by line", "Ovvoru line-aa"],
        [
          "Each line's progress today. Open a line to see who has been visited and who hasn't.",
          "Ovvoru line-um innaikku evlo mudichirukku nu paakalaam. Line-a open panna yaar visit pannaanga, yaar innum illa nu theriyum.",
        ],
      ),
      ...frame,
    ],
  },
  {
    path: "/dashboard/sectors",
    steps: [
      step(
        AT.header,
        ["Sectors side by side", "Sectors-a compare pannunga"],
        [
          "How each sector is doing on one day, so a weak one stands out.",
          "Oru naal-la ovvoru sector-um eppadi poguthu nu pakkathula pakkathula paakalaam — weak-aa irukkuradhu udane theriyum.",
        ],
      ),
      step(
        AT.actions,
        ["Pick the day", "Naal-a choose pannunga"],
        [
          "Change the date, or export the comparison.",
          "Date maathunga, illa indha comparison-a export pannunga.",
        ],
      ),
      step(
        AT.stats,
        ["Tallied, extra, low", "Tally, extra, kammi"],
        [
          "How many sectors collected exactly what was due, more, or less.",
          "Evlo sectors correct-aa collect pannaanga, adhigamaa pannaanga, kammiyaa pannaanga nu count.",
        ],
      ),
      step(
        AT.list,
        ["The comparison", "Comparison"],
        [
          "Expected against collected for each sector. Open one to see its lines.",
          "Ovvoru sector-kum expected vs collected. Oru sector-a open panna adhoda lines theriyum.",
        ],
      ),
    ],
  },
  {
    path: "/collections",
    steps: [
      step(
        AT.header,
        ["Collections", "Collections"],
        [
          "Every payment the Juniors recorded at the door, newest first.",
          "Juniors veettu vaasal-la record panna ella payment-um inga dhaan — pudhusu mela varum.",
        ],
      ),
      step(
        AT.filters,
        ["Narrow it down", "Filter pannunga"],
        [
          "Choose the dates and what to show. The filters stay in the link, so you can share exactly this view.",
          "From, To dates-um enna kaatanum nu-um choose pannunga. Filter link-laye irukkum, adhanaala indha view-a appadiye share pannalaam.",
        ],
      ),
      step(
        AT.list,
        ["One row per collection", "Oru row, oru collection"],
        [
          "Open a row to see the full collection and ask for a correction if the amount was wrong.",
          "Row-a click panna full details varum. Amount thappaa irundha anga correction kekkalaam.",
        ],
      ),
      step(
        AT.actions,
        ["Approvals and export", "Approvals, export"],
        [
          "Pending approvals lists corrections waiting for a decision. Export downloads this list.",
          "Pending approvals-la decide pannanum nu wait panra corrections irukkum. Export indha list-a download pannum.",
        ],
      ),
    ],
  },
  {
    path: "/collections/[collectionId]",
    steps: [
      step(
        AT.header,
        ["One collection", "Oru collection"],
        [
          "Who paid, on which account, and who recorded it.",
          "Yaar kuduthaanga, endha account-ku, yaar record pannaanga — ellaam inga.",
        ],
      ),
      step(
        AT.stats,
        ["What it stands at", "Ippo evlo"],
        [
          "Recorded is what was entered at the door; “stands at” includes any approved corrections.",
          "Recorded-na vaasal-la type pannadhu. “Stands at”-na approve aana corrections-um serthu ippo irukkura amount.",
        ],
      ),
      step(
        AT.actions,
        ["Wrong amount?", "Amount thappaa?"],
        [
          "A collection is never edited. Request a correction instead — someone approves it and the books follow. Reverse undoes it entirely.",
          "Collection-a edit panna mudiyaadhu. Correction request pannunga — yaaraavadhu approve pannadhum books-um maarum. Reverse full-aa cancel pannum.",
        ],
      ),
      step(
        AT.list,
        ["Its corrections", "Idhoda corrections"],
        [
          "Every correction asked for on this collection, and what was decided.",
          "Indha collection-ku ketta ella correction-um, adhula enna decide pannaanga nu-um.",
        ],
      ),
    ],
  },
  {
    path: "/collections/pending-approval",
    steps: [
      step(
        AT.header,
        ["Waiting for you", "Ungalukkaaga wait pannudhu"],
        [
          "Corrections the Juniors asked for. Each card shows the old amount, the new one and why.",
          "Juniors ketta corrections. Ovvoru card-layum pazhaya amount, pudhu amount, kaaranam — moonum irukkum.",
        ],
      ),
      step(
        undefined,
        ["Approve or reject", "Approve, illa reject"],
        [
          "Approve and the account and books change at once. Reject keeps the original. Add a note so the Junior knows why.",
          "Approve panna account-um books-um udane maarum. Reject panna pazhayadhe irukkum. Junior-ku puriyara maadhiri oru note podunga.",
        ],
      ),
    ],
  },
  {
    path: "/cash",
    steps: [
      step(
        AT.header,
        ["Cash", "Cash"],
        [
          "The cash the Juniors collected, on its way from their hands to the office.",
          "Juniors collect panna cash — avanga kaila irundhu office varaikkum eppadi varudhu nu inga paakalaam.",
        ],
      ),
      step(
        "main section",
        ["Acknowledge handovers", "Handover-a acknowledge pannunga"],
        [
          "When a Junior hands you cash, count it and acknowledge. If the count is different, dispute it — don't just accept.",
          "Junior cash kudutha, ennittu acknowledge pannunga. Count thappaa irundha dispute pannunga — appadiye accept panna vendaam.",
        ],
      ),
      step(
        AT.filters,
        ["Close the day", "Day close"],
        [
          "Pick a date and open its day close to check the line and close it.",
          "Date-a choose panni day close-a open pannunga — line-a check panni close pannalaam.",
        ],
      ),
      step(
        undefined,
        ["Field expenses", "Field expenses"],
        [
          "Petrol, tea, small spends the Juniors paid from the cash. Approve them so the handover adds up.",
          "Petrol, tea maadhiri Juniors cash-la irundhu selavu pannadhu. Approve pannaa dhaan handover tally aagum.",
        ],
      ),
    ],
  },
  {
    path: "/profile",
    steps: [
      step(
        AT.header,
        ["Your profile", "Unga profile"],
        [
          "Your name, role and staff code as the office has them.",
          "Office-la irukkura unga peru, role, staff code.",
        ],
      ),
      step(
        undefined,
        ["Password and this device", "Password, indha device"],
        [
          "Change your password here — every other device signs out. You can also switch between the phone and computer layouts, or install Rasi.",
          "Password inga maathalaam — maathina udane matha devices ellaam sign out aaidum. Phone / computer layout maathalaam, Rasi install-um pannalaam.",
        ],
      ),
    ],
  },
];
