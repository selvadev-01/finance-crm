import {
  notificationEventSchema,
  templateContentSchema,
} from '@repo/contracts';

import {
  CATALOGUE,
  channelLock,
  defaultChannels,
  noticeDefinition,
  type TemplateKey,
} from './catalogue.js';
import {
  effectiveChannels,
  renderMessage,
  sampleValues,
  templateProblems,
} from './notification-templates.js';

describe('the message catalogue (US-074)', () => {
  it('has one definition per key, every key the shape the database accepts', () => {
    const keys = CATALOGUE.map((definition) => definition.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) expect(key).toMatch(/^[A-Z][A-Z_]{0,63}$/);
  });

  it('covers every notification event at least once', () => {
    const raised = new Set(
      CATALOGUE.flatMap((definition) =>
        definition.notice ? [definition.notice.eventType] : [],
      ),
    );
    expect(
      [...notificationEventSchema.options].filter((e) => !raised.has(e)),
    ).toEqual([]);
  });

  it.each(
    CATALOGUE.flatMap((d) =>
      (['EN', 'TA'] as const).map((l) => [d.key, l] as const),
    ),
  )(
    '%s in %s: the default is a valid template within the contract limits',
    (key, language) => {
      const definition = CATALOGUE.find((d) => d.key === key)!;
      const content = definition.defaults[language];
      expect(templateProblems(definition, content)).toEqual([]);
      expect(templateContentSchema.safeParse(content).success).toBe(true);
    },
  );

  it.each(
    CATALOGUE.flatMap((d) =>
      (['EN', 'TA'] as const).map((l) => [d.key, l] as const),
    ),
  )(
    '%s in %s: renders with its samples to text with no braces left',
    (key, language) => {
      const definition = CATALOGUE.find((d) => d.key === key)!;
      const message = renderMessage(
        definition,
        definition.defaults[language],
        language,
        sampleValues(definition),
        { url: 'https://rasi.example/x', organizationName: 'Rasi Test' },
      );
      const words = [
        message.title,
        message.body,
        message.email.subject,
        message.email.text,
      ];
      for (const text of words) expect(text ?? '').not.toMatch(/\{\{|\}\}/);
      if (definition.notice) {
        expect(message.title).not.toBe('');
        expect(message.body).not.toBe('');
      }
    },
  );

  it('keeps the wording EventNotices wrote before templates — a business that edits nothing sends the same', () => {
    const render = (key: TemplateKey, values: Record<string, string>) =>
      renderMessage(
        noticeDefinition(key),
        noticeDefinition(key).defaults.EN,
        'EN',
        values,
        { url: '/', organizationName: 'Rasi Test' },
      );
    expect(
      render('MISSED_COLLECTION', {
        lineName: 'Line 3',
        date: '14 Sep 2026',
        count: '1',
        one: 'yes',
      }),
    ).toMatchObject({
      title: 'Missed collections · Line 3',
      body: '1 customer was not visited on 14 Sep 2026',
    });
    expect(
      render('HANDOVER_SUBMITTED', {
        lineName: 'Line 3',
        date: '14 Sep 2026',
        sender: 'Suresh',
        amount: '₹4,300.00',
        difference: '',
      }).body,
    ).toBe('Suresh handed over ₹4,300.00 for 14 Sep 2026');
    expect(
      render('ACCOUNT_DISBURSED', {
        accountCode: 'ACC-1',
        customerName: 'Guru',
        disbursedBy: 'Lakshmi',
        amount: '₹150.00',
        daily: 'yes',
        weekly: '',
        monthly: '',
        startDate: '05 Jan 2026',
      }).body,
    ).toBe("Lakshmi disbursed Guru's account: ₹150.00 a day from 05 Jan 2026");
    expect(render('ACCOUNT_OVERDUE', { count: '3', one: '' }).title).toBe(
      '3 accounts are overdue',
    );
  });

  it('pushes ALERT and WARNING and emails ALERT by default, and locks an ALERT on', () => {
    const low = noticeDefinition('LOW_COLLECTION');
    const extra = noticeDefinition('EXTRA_COLLECTION');
    const completed = noticeDefinition('ACCOUNT_COMPLETED');
    expect(defaultChannels(low)).toEqual({ push: true, email: true });
    expect(defaultChannels(extra)).toEqual({ push: true, email: false });
    expect(defaultChannels(completed)).toEqual({ push: false, email: false });
    expect(channelLock(low)).not.toBeNull();
    expect(channelLock(extra)).toBeNull();
    // A stored "off" for an alert — which the API refuses — is still overruled.
    expect(effectiveChannels(low, { push: false, email: false })).toEqual({
      push: true,
      email: true,
    });
    expect(effectiveChannels(extra, { push: false, email: true })).toEqual({
      push: false,
      email: true,
    });
  });

  it('refuses push words on an email-only message, and requires them on a notification', () => {
    const reset = CATALOGUE.find((d) => d.key === 'PASSWORD_RESET')!;
    expect(
      templateProblems(reset, { ...reset.defaults.EN, title: 'T', body: 'B' }),
    ).toEqual([
      { field: 'title', issue: 'this message is sent by email only' },
      { field: 'body', issue: 'this message is sent by email only' },
    ]);
    const low = noticeDefinition('LOW_COLLECTION');
    expect(templateProblems(low, { ...low.defaults.EN, body: null })).toEqual([
      { field: 'body', issue: 'is required' },
    ]);
  });

  it('lets the email use {{title}} and {{body}}, but not the in-app text', () => {
    const low = noticeDefinition('LOW_COLLECTION');
    expect(
      templateProblems(low, { ...low.defaults.EN, body: 'see {{title}}' }),
    ).toEqual([
      {
        field: 'body',
        issue: '{{title}} is not a placeholder of this message',
      },
    ]);
  });

  it('falls back to the default words for a field that renders blank', () => {
    const low = noticeDefinition('LOW_COLLECTION');
    const message = renderMessage(
      low,
      {
        ...low.defaults.EN,
        title: '{{#customerName}}{{customerName}}{{/customerName}}',
      },
      'EN',
      { accountCode: 'ACC-1', customerName: '' },
      { url: '/', organizationName: 'Rasi Test' },
    );
    expect(message.title).toBe('Low collection · ACC-1');
  });
});
