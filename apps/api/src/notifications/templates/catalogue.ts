import type {
  NotificationCategory,
  NotificationEvent,
  TemplateGroup,
  TemplateLanguage,
} from '@repo/contracts';

import { InternalError } from '../../platform/errors/errors.js';

/**
 * Every message Rasi sends (US-074), with its built-in wording in English and
 * Tamil. A business's Super Admin may override any of it per language
 * (`notification_template`) and switch push and email per message
 * (`notification_channel`); what is here is what applies until they do, and
 * what "Reset to default" goes back to.
 *
 * **A message is finer than an event.** `EXPENSE_DECIDED` is two messages,
 * approved and rejected, because they differ in category and in every word;
 * the same goes for a correction and a reversal, short and over cash, and a
 * new account and a running one. Each message has one category, so its
 * channel defaults and its ALERT lock are fixed.
 *
 * **The English defaults are the wording EventNotices wrote before templates
 * existed**, character for character, so a business that edits nothing sends
 * exactly what it did. The Tamil defaults were written with this feature
 * (2026-10-02) and want a native speaker's read before the business relies on
 * them — the Super Admin can correct any of them on the same screen.
 *
 * Placeholder values are formatted before rendering: money is `₹1,234.00`,
 * a date `14 Sep 2026`. A flag placeholder (`one`, `senior`, `daily`) is
 * `yes` or empty, for use as a section.
 *
 * The welcome email (US-006) is not here: it is sent in the transaction that
 * creates the business, before that business could have written a template.
 */

export interface TemplateContent {
  /** In-app and push. `null` for an email-only message. */
  title: string | null;
  body: string | null;
  emailSubject: string;
  emailHeading: string;
  /** Paragraphs separated by a blank line. */
  emailBody: string;
  emailAction: string;
  emailFooter: string;
}

export interface TemplateVariable {
  name: string;
  description: string;
  /** What the preview and "Send a test" fill it with. */
  sample: string;
  /** Usable in the email fields only — `title`, `body`. */
  emailOnly?: boolean;
}

export interface TemplateDefinition {
  key: string;
  label: string;
  description: string;
  group: TemplateGroup;
  /** Who receives it, in words, for the screen. */
  recipients: string;
  /** The in-app notification it raises; `null` for an email-only message. */
  notice: {
    eventType: NotificationEvent;
    category: NotificationCategory;
  } | null;
  variables: TemplateVariable[];
  defaults: Record<TemplateLanguage, TemplateContent>;
}

const ORGANISATION: TemplateVariable = {
  name: 'organizationName',
  description: 'Your business name',
  sample: 'Sri Kamakshi Finance',
};

/** What a notification's email copy may use beyond the event's own values. */
const EMAIL_EXTRAS: TemplateVariable[] = [
  {
    name: 'title',
    description: 'The in-app title, as written above',
    sample: '',
    emailOnly: true,
  },
  {
    name: 'body',
    description: 'The in-app text, as written above',
    sample: '',
    emailOnly: true,
  },
];

const EMAIL_COPY: Record<
  TemplateLanguage,
  { action: string; alertFooter: string; footer: string }
> = {
  EN: {
    action: 'View in Rasi',
    alertFooter:
      'An alert from {{organizationName}} on Rasi. Alerts are always emailed and cannot be switched off; the same alert is in your notifications in the app.',
    footer:
      'A notification from {{organizationName}} on Rasi. The same notification is in your notifications in the app.',
  },
  TA: {
    action: 'Rasi-இல் பார்க்கவும்',
    alertFooter:
      '{{organizationName}} இடமிருந்து Rasi எச்சரிக்கை. எச்சரிக்கைகள் எப்போதும் மின்னஞ்சலில் அனுப்பப்படும், அவற்றை நிறுத்த முடியாது; இதே எச்சரிக்கை செயலியில் உள்ள உங்கள் அறிவிப்புகளிலும் உள்ளது.',
    footer:
      '{{organizationName}} இடமிருந்து Rasi அறிவிப்பு. இதே அறிவிப்பு செயலியில் உள்ள உங்கள் அறிவிப்புகளிலும் உள்ளது.',
  },
};

type Words = { title: string; body: string };

/** A message that raises a notification; its email copy defaults to the same words. */
function event(input: {
  key: string;
  eventType: NotificationEvent;
  category: NotificationCategory;
  group: TemplateGroup;
  label: string;
  description: string;
  recipients: string;
  variables: TemplateVariable[];
  en: Words;
  ta: Words;
}): TemplateDefinition {
  const copy = (language: TemplateLanguage, words: Words): TemplateContent => ({
    title: words.title,
    body: words.body,
    emailSubject: '{{title}} — {{organizationName}}',
    emailHeading: '{{title}}',
    emailBody: '{{body}}',
    emailAction: EMAIL_COPY[language].action,
    emailFooter:
      input.category === 'ALERT'
        ? EMAIL_COPY[language].alertFooter
        : EMAIL_COPY[language].footer,
  });
  return {
    key: input.key,
    label: input.label,
    description: input.description,
    group: input.group,
    recipients: input.recipients,
    notice: { eventType: input.eventType, category: input.category },
    variables: [...input.variables, ORGANISATION, ...EMAIL_EXTRAS],
    defaults: { EN: copy('EN', input.en), TA: copy('TA', input.ta) },
  };
}

// Placeholders shared by several messages ------------------------------------

const v = {
  accountCode: {
    name: 'accountCode',
    description: 'The account number',
    sample: 'ACC-2026-00412',
  },
  customerName: {
    name: 'customerName',
    description: "The customer's name",
    sample: 'Meenakshi Sundaram',
  },
  lineName: { name: 'lineName', description: 'The line', sample: 'Mylapore A' },
  date: {
    name: 'date',
    description: 'The business day',
    sample: '14 Sep 2026',
  },
  amount: { name: 'amount', description: 'The amount', sample: '₹4,300.00' },
  difference: {
    name: 'difference',
    description: 'The difference from the record; empty when there is none',
    sample: '₹20.00',
  },
  count: { name: 'count', description: 'How many', sample: '3' },
  one: {
    name: 'one',
    description:
      'Set when the count is exactly one — use {{#one}}…{{/one}}{{^one}}…{{/one}}',
    sample: '',
  },
  instalment: [
    { name: 'amount', description: 'The instalment', sample: '₹150.00' },
    {
      name: 'daily',
      description: 'Set for a daily account',
      sample: 'yes',
    },
    { name: 'weekly', description: 'Set for a weekly account', sample: '' },
    { name: 'monthly', description: 'Set for a monthly account', sample: '' },
    {
      name: 'startDate',
      description: 'The first instalment due',
      sample: '05 Jan 2026',
    },
  ],
} satisfies Record<string, TemplateVariable | TemplateVariable[]>;

const PER_EN =
  '{{#daily}}a day{{/daily}}{{#weekly}}a week{{/weekly}}{{#monthly}}a month{{/monthly}}';
const PER_TA =
  '{{#daily}}நாளொன்றுக்கு{{/daily}}{{#weekly}}வாரத்திற்கு{{/weekly}}{{#monthly}}மாதத்திற்கு{{/monthly}}';

const correction = (reversal: boolean): TemplateDefinition =>
  event({
    key: reversal ? 'REVERSAL_REQUESTED' : 'CORRECTION_REQUESTED',
    eventType: 'APPROVAL_REQUESTED',
    category: 'WARNING',
    group: 'COLLECTIONS',
    label: reversal ? 'Reversal to approve' : 'Correction to approve',
    description: reversal
      ? 'Someone asks to reverse a collection.'
      : 'Someone asks to correct a collection amount.',
    recipients: reversal
      ? "The line's Senior and the Admins"
      : "The line's Senior; the Admins for a Senior's own request",
    variables: [
      v.accountCode,
      v.customerName,
      { name: 'requester', description: 'Who asked', sample: 'Suresh Kumar' },
      { name: 'from', description: 'The amount recorded', sample: '₹100.00' },
      { name: 'to', description: 'The amount asked for', sample: '₹80.00' },
    ],
    en: {
      title: `${reversal ? 'Reversal' : 'Correction'} to approve · {{accountCode}}`,
      body: "{{requester}} asks to change {{customerName}}'s collection from {{from}} to {{to}}",
    },
    ta: {
      title: `ஒப்புதலுக்கான ${reversal ? 'ரத்து' : 'திருத்தம்'} · {{accountCode}}`,
      body: '{{customerName}} அவர்களின் வசூலை {{from}} இலிருந்து {{to}} ஆக மாற்ற {{requester}} கேட்கிறார்',
    },
  });

const disbursed = (midTerm: boolean): TemplateDefinition =>
  event({
    key: midTerm ? 'RUNNING_ACCOUNT_ADDED' : 'ACCOUNT_DISBURSED',
    eventType: 'ACCOUNT_DISBURSED',
    category: 'INFORMATION',
    group: 'ACCOUNTS',
    label: midTerm ? 'Running account added' : 'Account disbursed',
    description: midTerm
      ? 'An account already running on paper is entered mid-term.'
      : 'A new account is paid out and joins the round.',
    recipients: "The Senior of the customer's line today",
    variables: [
      v.accountCode,
      v.customerName,
      {
        name: 'disbursedBy',
        description: 'Who entered it',
        sample: 'Lakshmi Narayanan',
      },
      ...v.instalment,
    ],
    en: midTerm
      ? {
          title: 'Running account added · {{accountCode}}',
          body: `{{disbursedBy}} entered {{customerName}}'s running account: {{amount}} ${PER_EN} from {{startDate}}`,
        }
      : {
          title: 'Account disbursed · {{accountCode}}',
          body: `{{disbursedBy}} disbursed {{customerName}}'s account: {{amount}} ${PER_EN} from {{startDate}}`,
        },
    ta: midTerm
      ? {
          title: 'நடப்பு கணக்கு சேர்க்கப்பட்டது · {{accountCode}}',
          body: `{{disbursedBy}} {{customerName}} அவர்களின் நடப்பு கணக்கைப் பதிவு செய்தார்: {{startDate}} முதல் ${PER_TA} {{amount}}`,
        }
      : {
          title: 'கடன் வழங்கப்பட்டது · {{accountCode}}',
          body: `{{disbursedBy}} {{customerName}} அவர்களுக்குக் கடன் வழங்கினார்: {{startDate}} முதல் ${PER_TA} {{amount}}`,
        },
  });

const expenseDecided = (approved: boolean): TemplateDefinition => {
  const common = [
    { name: 'amount', description: 'The expense', sample: '₹50.00' },
    {
      name: 'decidedBy',
      description: 'Who decided',
      sample: 'Lakshmi Narayanan',
    },
    { name: 'expenseType', description: 'What it was for', sample: 'fuel' },
  ];
  return event({
    key: approved ? 'EXPENSE_APPROVED' : 'EXPENSE_REJECTED',
    eventType: 'EXPENSE_DECIDED',
    category: approved ? 'SUCCESS' : 'WARNING',
    group: 'CASH',
    label: approved ? 'Expense approved' : 'Expense rejected',
    description: approved
      ? 'A field expense was approved.'
      : 'A field expense was rejected, with the reason.',
    recipients: 'The person who spent it',
    variables: approved
      ? common
      : [
          ...common,
          {
            name: 'reason',
            description: 'Why it was rejected',
            sample: 'No bill',
          },
        ],
    en: approved
      ? {
          title: 'Expense approved · {{amount}}',
          body: '{{decidedBy}} approved your {{expenseType}} expense; it comes off what you hand over',
        }
      : {
          title: 'Expense rejected · {{amount}}',
          body: '{{decidedBy}} rejected your {{expenseType}} expense: {{reason}}. Hand that cash over with the rest',
        },
    ta: approved
      ? {
          title: 'செலவு ஏற்கப்பட்டது · {{amount}}',
          body: 'உங்கள் {{expenseType}} செலவை {{decidedBy}} ஏற்றுக்கொண்டார்; நீங்கள் ஒப்படைக்கும் தொகையிலிருந்து இது கழிக்கப்படும்',
        }
      : {
          title: 'செலவு நிராகரிக்கப்பட்டது · {{amount}}',
          body: 'உங்கள் {{expenseType}} செலவை {{decidedBy}} நிராகரித்தார்: {{reason}}. அந்தப் பணத்தையும் மற்ற பணத்துடன் ஒப்படைக்கவும்',
        },
  });
};

const handoverAcknowledged = (differs: boolean): TemplateDefinition =>
  event({
    key: differs ? 'HANDOVER_ACKNOWLEDGED_DIFFERENT' : 'HANDOVER_ACKNOWLEDGED',
    eventType: 'HANDOVER_ACKNOWLEDGED',
    category: differs ? 'WARNING' : 'SUCCESS',
    group: 'CASH',
    label: differs ? 'Cash received, count differs' : 'Cash received',
    description: differs
      ? 'The receiver counted a different amount from what was declared.'
      : 'The receiver counted the cash and it matched.',
    recipients: 'The person who handed it over',
    variables: [
      v.lineName,
      v.date,
      {
        name: 'receiver',
        description: 'Who counted it',
        sample: 'Ravi Shankar',
      },
      {
        name: 'counted',
        description: 'What they counted',
        sample: '₹4,280.00',
      },
      ...(differs ? [v.difference] : []),
    ],
    en: {
      title: 'Cash received · {{lineName}}',
      body: differs
        ? '{{receiver}} counted {{counted}} for {{date}}, {{difference}} against what you declared'
        : '{{receiver}} counted {{counted}} for {{date}}',
    },
    ta: {
      title: 'பணம் பெறப்பட்டது · {{lineName}}',
      body: differs
        ? '{{receiver}} {{date}} க்கான {{counted}} எண்ணிப் பெற்றார்; நீங்கள் அறிவித்ததை விட {{difference}} வேறுபாடு'
        : '{{receiver}} {{date}} க்கான {{counted}} எண்ணிப் பெற்றார்',
    },
  });

const cashDiscrepancy = (short: boolean): TemplateDefinition =>
  event({
    key: short ? 'CASH_SHORT' : 'CASH_OVER',
    eventType: 'DAY_CLOSE_DISCREPANCY',
    category: 'ALERT',
    group: 'CASH',
    label: short ? 'Cash short' : 'Cash over',
    description: `Cash was acknowledged ${short ? 'short of' : 'over'} the record.`,
    recipients: "The line's Senior and the Admins",
    variables: [v.lineName, v.date, v.difference],
    en: {
      title: `Cash ${short ? 'short' : 'over'} · {{lineName}}`,
      body: `Cash for {{date}} was acknowledged {{difference}} ${short ? 'short of' : 'over'} the record`,
    },
    ta: {
      title: `பணம் ${short ? 'குறைவு' : 'அதிகம்'} · {{lineName}}`,
      body: `{{date}} க்கான பணம் பதிவை விட {{difference}} ${short ? 'குறைவாக' : 'அதிகமாக'} ஏற்கப்பட்டது`,
    },
  });

const holiday = (declared: boolean): TemplateDefinition => {
  const where = (text: string) =>
    `{{#sectorName}} {{sectorName}}${text}{{/sectorName}}`;
  return event({
    key: declared ? 'HOLIDAY_DECLARED' : 'HOLIDAY_REMOVED',
    eventType: declared ? 'HOLIDAY_DECLARED' : 'HOLIDAY_REMOVED',
    category: 'WARNING',
    group: 'ORGANISATION',
    label: declared ? 'Holiday declared' : 'Holiday removed',
    description: declared
      ? 'A holiday moves the collections due that day.'
      : 'A removed holiday is a working day again.',
    recipients: 'Seniors and Juniors of the lines it covers',
    variables: [
      { name: 'holidayName', description: 'The holiday', sample: 'Pongal' },
      v.date,
      {
        name: 'sectorName',
        description: 'The sector it covers; empty when it covers every line',
        sample: 'Chennai South',
      },
    ],
    en: declared
      ? {
          title: 'Holiday declared · {{date}}',
          body: `{{holidayName}}: no collections on {{date}}{{#sectorName}} in {{sectorName}}{{/sectorName}}. Collections due that day and after move to the next working day.`,
        }
      : {
          title: 'Holiday removed · {{date}}',
          body: `{{holidayName}} on {{date}}{{#sectorName}} in {{sectorName}}{{/sectorName}} is a working day again. Collections after it move a day earlier.`,
        },
    ta: declared
      ? {
          title: 'விடுமுறை அறிவிப்பு · {{date}}',
          body: `{{holidayName}}: {{date}} அன்று${where(' பகுதியில்')} வசூல் இல்லை. அன்றும் அதற்குப் பிறகும் உள்ள வசூல்கள் அடுத்த வேலை நாளுக்கு மாறும்.`,
        }
      : {
          title: 'விடுமுறை நீக்கப்பட்டது · {{date}}',
          body: `{{date}} அன்று${where(' பகுதியில்')} இருந்த {{holidayName}} இனி வேலை நாள். அதற்குப் பிறகான வசூல்கள் ஒரு நாள் முன்னதாக மாறும்.`,
        },
  });
};

export const CATALOGUE: readonly TemplateDefinition[] = [
  // Collections -------------------------------------------------------------
  event({
    key: 'LOW_COLLECTION',
    eventType: 'LOW_COLLECTION',
    category: 'ALERT',
    group: 'COLLECTIONS',
    label: 'Low collection',
    description: 'A Junior collected less than was due.',
    recipients: "The line's Senior",
    variables: [
      v.accountCode,
      v.customerName,
      {
        name: 'collector',
        description: 'Who collected',
        sample: 'Suresh Kumar',
      },
      { name: 'amount', description: 'What was collected', sample: '₹80.00' },
      { name: 'expected', description: 'What was due', sample: '₹100.00' },
    ],
    en: {
      title: 'Low collection · {{accountCode}}',
      body: '{{collector}} collected {{amount}} of {{expected}} from {{customerName}}',
    },
    ta: {
      title: 'குறைவான வசூல் · {{accountCode}}',
      body: '{{collector}} {{customerName}} அவர்களிடம் {{expected}} க்கு {{amount}} மட்டுமே வசூலித்தார்',
    },
  }),
  event({
    key: 'NO_PAYMENT_COLLECTION',
    eventType: 'NO_PAYMENT_COLLECTION',
    category: 'ALERT',
    group: 'COLLECTIONS',
    label: 'No payment',
    description: 'A Junior visited and the customer paid nothing.',
    recipients: "The line's Senior",
    variables: [
      v.accountCode,
      v.customerName,
      { name: 'collector', description: 'Who visited', sample: 'Suresh Kumar' },
      { name: 'expected', description: 'What was due', sample: '₹100.00' },
    ],
    en: {
      title: 'No payment · {{accountCode}}',
      body: '{{collector}} visited {{customerName}}, who paid nothing ({{expected}} was due)',
    },
    ta: {
      title: 'பணம் வரவில்லை · {{accountCode}}',
      body: '{{collector}} {{customerName}} அவர்களைச் சந்தித்தார்; பணம் எதுவும் செலுத்தப்படவில்லை ({{expected}} செலுத்த வேண்டியது)',
    },
  }),
  event({
    key: 'EXTRA_COLLECTION',
    eventType: 'EXTRA_COLLECTION',
    category: 'WARNING',
    group: 'COLLECTIONS',
    label: 'Extra collection',
    description: 'A Junior collected more than was due.',
    recipients: "The line's Senior",
    variables: [
      v.accountCode,
      v.customerName,
      {
        name: 'collector',
        description: 'Who collected',
        sample: 'Suresh Kumar',
      },
      { name: 'amount', description: 'What was collected', sample: '₹120.00' },
      { name: 'expected', description: 'What was due', sample: '₹100.00' },
    ],
    en: {
      title: 'Extra collection · {{accountCode}}',
      body: '{{collector}} collected {{amount}} against {{expected}} from {{customerName}}',
    },
    ta: {
      title: 'கூடுதல் வசூல் · {{accountCode}}',
      body: '{{collector}} {{customerName}} அவர்களிடம் {{expected}} க்கு பதிலாக {{amount}} வசூலித்தார்',
    },
  }),
  event({
    key: 'MISSED_COLLECTION',
    eventType: 'MISSED_COLLECTION',
    category: 'ALERT',
    group: 'COLLECTIONS',
    label: 'Missed collections',
    description: 'Customers not visited, counted once when the day is closed.',
    recipients: "The line's Senior",
    variables: [v.lineName, v.date, v.count, v.one],
    en: {
      title: 'Missed collections · {{lineName}}',
      body: '{{count}} {{#one}}customer was{{/one}}{{^one}}customers were{{/one}} not visited on {{date}}',
    },
    ta: {
      title: 'தவறிய வசூல் · {{lineName}}',
      body: '{{date}} அன்று {{count}} {{#one}}வாடிக்கையாளர்{{/one}}{{^one}}வாடிக்கையாளர்கள்{{/one}} சந்திக்கப்படவில்லை',
    },
  }),
  correction(false),
  correction(true),
  event({
    key: 'DAY_REOPENED',
    eventType: 'DAY_REOPENED',
    category: 'WARNING',
    group: 'COLLECTIONS',
    label: 'Day reopened',
    description: 'A collection arrived for a day already closed.',
    recipients: "The line's Senior",
    variables: [v.lineName, v.date],
    en: {
      title: 'Day reopened · {{lineName}}',
      body: 'A collection for {{date}} arrived after the day was closed. Close it again to re-tally.',
    },
    ta: {
      title: 'நாள் மீண்டும் திறக்கப்பட்டது · {{lineName}}',
      body: 'நாள் முடிக்கப்பட்ட பிறகு {{date}} க்கான வசூல் ஒன்று வந்தது. மீண்டும் கணக்கிட நாளை மறுபடி முடிக்கவும்.',
    },
  }),

  // Accounts and customers --------------------------------------------------
  event({
    key: 'NEW_CUSTOMER',
    eventType: 'NEW_CUSTOMER',
    category: 'INFORMATION',
    group: 'ACCOUNTS',
    label: 'New customer',
    description: 'A customer is onboarded onto a line.',
    recipients: "The Senior of the customer's line",
    variables: [
      v.lineName,
      v.customerName,
      {
        name: 'customerCode',
        description: 'The customer number',
        sample: 'CUS-00231',
      },
      {
        name: 'onboardedBy',
        description: 'Who onboarded them',
        sample: 'Lakshmi Narayanan',
      },
    ],
    en: {
      title: 'New customer · {{lineName}}',
      body: '{{onboardedBy}} onboarded {{customerName}} ({{customerCode}}) onto {{lineName}}',
    },
    ta: {
      title: 'புதிய வாடிக்கையாளர் · {{lineName}}',
      body: '{{onboardedBy}} {{customerName}} ({{customerCode}}) அவர்களை {{lineName}} இல் சேர்த்தார்',
    },
  }),
  // A Senior's account waits for an Admin (decided 2026-10-03).
  event({
    key: 'ACCOUNT_APPROVAL_REQUESTED',
    eventType: 'ACCOUNT_APPROVAL_REQUESTED',
    category: 'WARNING',
    group: 'ACCOUNTS',
    label: 'Account to approve',
    description: 'A Senior opened an account that waits for approval.',
    recipients: 'The Admins and the Super Admin',
    variables: [
      v.lineName,
      v.customerName,
      v.accountCode,
      {
        name: 'openedBy',
        description: 'The Senior who opened it',
        sample: 'Priya Senthil',
      },
      {
        name: 'amount',
        description: 'The account amount',
        sample: '₹10,000.00',
      },
    ],
    en: {
      title: 'Account to approve · {{lineName}}',
      body: "{{openedBy}} opened {{customerName}}'s account {{accountCode}} for {{amount}}. Approve it before it can be disbursed.",
    },
    ta: {
      title: 'ஒப்புதலுக்கான கணக்கு · {{lineName}}',
      body: '{{openedBy}} {{customerName}} அவர்களுக்கு {{amount}} க்கான கணக்கு {{accountCode}} தொடங்கினார். பணம் வழங்கும் முன் ஒப்புதல் அளிக்கவும்.',
    },
  }),
  event({
    key: 'ACCOUNT_APPROVED',
    eventType: 'ACCOUNT_APPROVED',
    category: 'SUCCESS',
    group: 'ACCOUNTS',
    label: 'Account approved',
    description: "A Senior's account was approved.",
    recipients: 'The Senior who opened it',
    variables: [
      v.customerName,
      v.accountCode,
      {
        name: 'approvedBy',
        description: 'Who approved it',
        sample: 'Lakshmi Narayanan',
      },
    ],
    en: {
      title: 'Account approved · {{accountCode}}',
      body: "{{approvedBy}} approved {{customerName}}'s account. The Super Admin disburses it next.",
    },
    ta: {
      title: 'கணக்கு ஒப்புதல் பெற்றது · {{accountCode}}',
      body: '{{approvedBy}} {{customerName}} அவர்களின் கணக்கை ஒப்புதல் அளித்தார். அடுத்து சூப்பர் அட்மின் பணம் வழங்குவார்.',
    },
  }),
  disbursed(false),
  disbursed(true),
  event({
    key: 'ACCOUNT_COMPLETED',
    eventType: 'ACCOUNT_COMPLETED',
    category: 'SUCCESS',
    group: 'ACCOUNTS',
    label: 'Account completed',
    description: 'The collection that pays an account in full.',
    recipients: "The line's Senior",
    variables: [v.accountCode, v.customerName],
    en: {
      title: 'Account completed · {{accountCode}}',
      body: '{{customerName}} has paid the account in full',
    },
    ta: {
      title: 'கணக்கு முடிந்தது · {{accountCode}}',
      body: '{{customerName}} கணக்கை முழுமையாகச் செலுத்திவிட்டார்',
    },
  }),
  event({
    key: 'ACCOUNT_OVERDUE',
    eventType: 'ACCOUNT_OVERDUE',
    category: 'WARNING',
    group: 'ACCOUNTS',
    label: 'Accounts overdue',
    description: 'Accounts past their target date, once per line each night.',
    recipients: "The line's Senior",
    variables: [v.count, v.one],
    en: {
      title:
        '{{#one}}An account is{{/one}}{{^one}}{{count}} accounts are{{/one}} overdue',
      body: '{{#one}}It has{{/one}}{{^one}}They have{{/one}} passed the target completion date with money still owed.',
    },
    ta: {
      title:
        '{{#one}}ஒரு கணக்கின்{{/one}}{{^one}}{{count}} கணக்குகளின்{{/one}} தவணை கடந்துவிட்டது',
      body: 'இலக்கு முடிவுத் தேதி கடந்தும் நிலுவைத் தொகை உள்ளது.',
    },
  }),

  // Cash --------------------------------------------------------------------
  event({
    key: 'HANDOVER_SUBMITTED',
    eventType: 'HANDOVER_SUBMITTED',
    category: 'INFORMATION',
    group: 'CASH',
    label: 'Cash to acknowledge',
    description: 'Someone handed over cash and it waits to be counted.',
    recipients: 'The person receiving it',
    variables: [
      v.lineName,
      v.date,
      {
        name: 'sender',
        description: 'Who handed it over',
        sample: 'Suresh Kumar',
      },
      {
        name: 'amount',
        description: 'What they declared',
        sample: '₹4,300.00',
      },
      v.difference,
    ],
    en: {
      title: 'Cash to acknowledge · {{lineName}}',
      body: '{{sender}} handed over {{amount}} for {{date}}{{#difference}} ({{difference}} against the record){{/difference}}',
    },
    ta: {
      title: 'ஏற்க வேண்டிய பணம் · {{lineName}}',
      body: '{{sender}} {{date}} க்கான {{amount}} ஒப்படைத்தார்{{#difference}} (பதிவை விட {{difference}} வேறுபாடு){{/difference}}',
    },
  }),
  handoverAcknowledged(false),
  handoverAcknowledged(true),
  event({
    key: 'HANDOVER_DISPUTED',
    eventType: 'HANDOVER_DISPUTED',
    category: 'ALERT',
    group: 'CASH',
    label: 'Handover disputed',
    description: 'A handover is disputed and goes to the Admins.',
    recipients: 'Sender, receiver and the Admins',
    variables: [
      v.lineName,
      v.date,
      {
        name: 'disputedBy',
        description: 'Who disputed it',
        sample: 'Ravi Shankar',
      },
      { name: 'amount', description: 'What was declared', sample: '₹4,300.00' },
      {
        name: 'note',
        description: 'Their reason',
        sample: 'Two ₹500 notes short',
      },
    ],
    en: {
      title: 'Handover disputed · {{lineName}}',
      body: '{{disputedBy}} disputed {{amount}} for {{date}}: {{note}}',
    },
    ta: {
      title: 'ஒப்படைப்பில் சர்ச்சை · {{lineName}}',
      body: '{{disputedBy}} {{date}} க்கான {{amount}} குறித்து சர்ச்சை எழுப்பினார்: {{note}}',
    },
  }),
  cashDiscrepancy(true),
  cashDiscrepancy(false),
  event({
    key: 'EXPENSE_REQUESTED',
    eventType: 'EXPENSE_REQUESTED',
    category: 'WARNING',
    group: 'CASH',
    label: 'Expense to approve',
    description: 'Someone spent collected cash on the round.',
    recipients:
      "A Junior's: the line's Senior and the Admins; a Senior's: the Admins",
    variables: [
      v.lineName,
      { name: 'spender', description: 'Who spent it', sample: 'Suresh Kumar' },
      { name: 'amount', description: 'The expense', sample: '₹50.00' },
      { name: 'expenseType', description: 'What it was for', sample: 'fuel' },
      {
        name: 'note',
        description: 'Their note',
        sample: 'Petrol for the round',
      },
    ],
    en: {
      title: 'Expense to approve · {{lineName}}',
      body: '{{spender}} spent {{amount}} on {{expenseType}} from collected cash: {{note}}',
    },
    ta: {
      title: 'ஒப்புதலுக்கான செலவு · {{lineName}}',
      body: '{{spender}} வசூல் பணத்திலிருந்து {{expenseType}} செலவுக்கு {{amount}} செலவழித்தார்: {{note}}',
    },
  }),
  expenseDecided(true),
  expenseDecided(false),

  // Organisation ------------------------------------------------------------
  event({
    key: 'NEW_ASSIGNMENT',
    eventType: 'NEW_ASSIGNMENT',
    category: 'INFORMATION',
    group: 'ORGANISATION',
    label: 'New assignment',
    description: 'Someone is assigned to a line.',
    recipients: 'The person assigned and the Seniors of both lines',
    variables: [
      v.lineName,
      {
        name: 'staffName',
        description: 'Who was assigned',
        sample: 'Suresh Kumar',
      },
      {
        name: 'senior',
        description:
          'Set when they are the Senior — use {{#senior}}…{{/senior}}{{^senior}}…{{/senior}}',
        sample: '',
      },
      { name: 'startDate', description: 'From when', sample: '15 Sep 2026' },
    ],
    en: {
      title: 'New assignment · {{lineName}}',
      body: '{{staffName}} is {{#senior}}Senior{{/senior}}{{^senior}}a Junior{{/senior}} on {{lineName}} from {{startDate}}',
    },
    ta: {
      title: 'புதிய பணி ஒதுக்கீடு · {{lineName}}',
      body: '{{startDate}} முதல் {{staffName}} {{lineName}} இல் {{#senior}}சீனியர்{{/senior}}{{^senior}}ஜூனியர்{{/senior}} ஆக இருப்பார்',
    },
  }),
  holiday(true),
  holiday(false),

  // System ------------------------------------------------------------------
  event({
    key: 'RECONCILIATION_MISMATCH',
    eventType: 'RECONCILIATION_MISMATCH',
    category: 'ALERT',
    group: 'SYSTEM',
    label: 'Reconciliation mismatch',
    description: 'The nightly reconciliation found figures that disagree.',
    recipients: 'Admins and the Super Admin',
    variables: [
      {
        name: 'rebuilt',
        description: 'Ledger balances rebuilt; empty when none',
        sample: '1',
      },
      {
        name: 'rebuiltOne',
        description: 'Set when exactly one was rebuilt',
        sample: 'yes',
      },
      {
        name: 'accountMismatches',
        description: 'Accounts that disagree with the ledger; empty when none',
        sample: '',
      },
      {
        name: 'accountMismatchOne',
        description: 'Set when exactly one account disagrees',
        sample: '',
      },
      {
        name: 'unearned',
        description: 'Set when unearned profit disagrees with the accounts',
        sample: '',
      },
    ],
    en: {
      title: 'Nightly reconciliation found a mismatch',
      body: '{{#rebuilt}}{{rebuilt}} ledger {{#rebuiltOne}}balance{{/rebuiltOne}}{{^rebuiltOne}}balances{{/rebuiltOne}} rebuilt. {{/rebuilt}}{{#accountMismatches}}{{accountMismatches}} {{#accountMismatchOne}}account disagrees{{/accountMismatchOne}}{{^accountMismatchOne}}accounts disagree{{/accountMismatchOne}} with the ledger. {{/accountMismatches}}{{#unearned}}Unearned profit disagrees with the accounts. {{/unearned}}Details are in the audit log.',
    },
    ta: {
      title: 'இரவு சரிபார்ப்பில் வேறுபாடு கண்டறியப்பட்டது',
      body: '{{#rebuilt}}{{rebuilt}} லெட்ஜர் இருப்புகள் மீண்டும் கணக்கிடப்பட்டன. {{/rebuilt}}{{#accountMismatches}}{{accountMismatches}} கணக்குகள் லெட்ஜருடன் பொருந்தவில்லை. {{/accountMismatches}}{{#unearned}}ஈட்டப்படாத லாபம் கணக்குகளுடன் பொருந்தவில்லை. {{/unearned}}விவரங்கள் தணிக்கைப் பதிவில் உள்ளன.',
    },
  }),
  event({
    key: 'JOB_FAILED',
    eventType: 'JOB_FAILED',
    category: 'ALERT',
    group: 'SYSTEM',
    label: 'Scheduled job failed',
    description: 'A nightly or minute job failed five times and stopped.',
    recipients: 'Admins and the Super Admin',
    variables: [
      {
        name: 'jobName',
        description: 'The job',
        sample: 'Nightly reconciliation',
      },
      {
        name: 'lastError',
        description: 'Its last error; empty when there was none',
        sample: 'connection timed out',
      },
    ],
    en: {
      title: 'Scheduled job failed · {{jobName}}',
      body: 'It failed five times and has stopped retrying.{{#lastError}} Last error: {{lastError}}{{/lastError}} Tell whoever runs the server.',
    },
    ta: {
      title: 'திட்டமிட்ட பணி தோல்வி · {{jobName}}',
      body: 'ஐந்து முறை தோல்வியடைந்ததால் மீண்டும் முயற்சிப்பது நிறுத்தப்பட்டது.{{#lastError}} கடைசி பிழை: {{lastError}}{{/lastError}} சர்வரை நிர்வகிப்பவரிடம் தெரிவிக்கவும்.',
    },
  }),

  // Sign-in -----------------------------------------------------------------
  {
    key: 'PASSWORD_RESET',
    label: 'Password reset link',
    description:
      'The link a staff member asks for when they forget their password (US-003). Email only.',
    group: 'SIGN_IN',
    recipients: 'The person who asked',
    notice: null,
    variables: [
      { name: 'name', description: 'Their name', sample: 'Suresh Kumar' },
      {
        name: 'validForMinutes',
        description: 'How long the link lasts',
        sample: '30',
      },
      ORGANISATION,
    ],
    defaults: {
      EN: {
        title: null,
        body: null,
        emailSubject: 'Set a new Rasi password',
        emailHeading: 'Set a new password',
        emailBody: [
          'Hello {{name}},',
          'Use the button below to set a new password. The link works once and lasts {{validForMinutes}} minutes.',
          'If you did not ask for this, ignore this email — your password stays as it is.',
        ].join('\n\n'),
        emailAction: 'Set a new password',
        emailFooter:
          'You are receiving this because someone asked to reset the password for this Rasi account. Tell your Admin if it was not you.',
      },
      TA: {
        title: null,
        body: null,
        emailSubject: 'புதிய Rasi கடவுச்சொல்லை அமைக்கவும்',
        emailHeading: 'புதிய கடவுச்சொல்லை அமைக்கவும்',
        emailBody: [
          'வணக்கம் {{name}},',
          'புதிய கடவுச்சொல்லை அமைக்க கீழே உள்ள பொத்தானைப் பயன்படுத்தவும். இந்த இணைப்பு ஒரு முறை மட்டுமே வேலை செய்யும், {{validForMinutes}} நிமிடங்கள் வரை செல்லுபடியாகும்.',
          'நீங்கள் இதைக் கேட்கவில்லை என்றால், இந்த மின்னஞ்சலைப் புறக்கணிக்கவும் — உங்கள் கடவுச்சொல் மாறாது.',
        ].join('\n\n'),
        emailAction: 'புதிய கடவுச்சொல்லை அமைக்கவும்',
        emailFooter:
          'இந்த Rasi கணக்கின் கடவுச்சொல்லை மீட்டமைக்க யாரோ கேட்டதால் இந்த மின்னஞ்சல் வந்துள்ளது. அது நீங்கள் இல்லையென்றால் உங்கள் நிர்வாகியிடம் தெரிவிக்கவும்.',
      },
    },
  },
];

const BY_KEY = new Map(
  CATALOGUE.map((definition) => [definition.key, definition]),
);

export function templateDefinition(
  key: string,
): TemplateDefinition | undefined {
  return BY_KEY.get(key);
}

/** The keys EventNotices may raise — a typo is a type error, not a blank push. */
export type TemplateKey =
  | 'LOW_COLLECTION'
  | 'NO_PAYMENT_COLLECTION'
  | 'EXTRA_COLLECTION'
  | 'MISSED_COLLECTION'
  | 'CORRECTION_REQUESTED'
  | 'REVERSAL_REQUESTED'
  | 'DAY_REOPENED'
  | 'NEW_CUSTOMER'
  | 'ACCOUNT_APPROVAL_REQUESTED'
  | 'ACCOUNT_APPROVED'
  | 'ACCOUNT_DISBURSED'
  | 'RUNNING_ACCOUNT_ADDED'
  | 'ACCOUNT_COMPLETED'
  | 'ACCOUNT_OVERDUE'
  | 'HANDOVER_SUBMITTED'
  | 'HANDOVER_ACKNOWLEDGED'
  | 'HANDOVER_ACKNOWLEDGED_DIFFERENT'
  | 'HANDOVER_DISPUTED'
  | 'CASH_SHORT'
  | 'CASH_OVER'
  | 'EXPENSE_REQUESTED'
  | 'EXPENSE_APPROVED'
  | 'EXPENSE_REJECTED'
  | 'NEW_ASSIGNMENT'
  | 'HOLIDAY_DECLARED'
  | 'HOLIDAY_REMOVED'
  | 'RECONCILIATION_MISMATCH'
  | 'JOB_FAILED'
  | 'PASSWORD_RESET';

/** A template key known to raise a notification, with its definition. */
export function noticeDefinition(key: TemplateKey): TemplateDefinition & {
  notice: NonNullable<TemplateDefinition['notice']>;
} {
  const definition = BY_KEY.get(key);
  if (!definition?.notice) {
    throw new InternalError(
      'TEMPLATE_MISSING',
      `${key} is not a notification template`,
    );
  }
  return definition as TemplateDefinition & {
    notice: NonNullable<TemplateDefinition['notice']>;
  };
}

/**
 * Push and email by default, from the category (notifications.md): ALERT and
 * WARNING buzz a phone, only ALERT is emailed — warnings fire on every extra
 * collection and correction request, and an inbox would drown in them. An
 * email-only message is always emailed.
 */
export function defaultChannels(definition: TemplateDefinition): {
  push: boolean;
  email: boolean;
} {
  const category = definition.notice?.category;
  if (!category) return { push: false, email: true };
  return {
    push: category === 'ALERT' || category === 'WARNING',
    email: category === 'ALERT',
  };
}

/**
 * Why a channel cannot be switched off, or `null`. An ALERT is pushed and
 * emailed whatever the business prefers — the same rule as US-073's
 * preferences, one level up — and a password reset that is not emailed does
 * not happen at all.
 */
export function channelLock(definition: TemplateDefinition): string | null {
  if (!definition.notice) {
    return 'This message is only sent by email, so its email cannot be switched off.';
  }
  return definition.notice.category === 'ALERT'
    ? 'Alerts are always pushed and emailed — they are what the business exists to act on.'
    : null;
}
