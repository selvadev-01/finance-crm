import { parseTemplate, renderTemplate } from './template-engine.js';

const known = new Set(['name', 'count', 'one', 'difference']);

describe('notification template placeholders (US-074)', () => {
  it('fills a value, and trims spaces inside the braces', () => {
    expect(
      renderTemplate('Hello {{name}}, hello {{ name }}', { name: 'Meena' }),
    ).toBe('Hello Meena, hello Meena');
  });

  it('shows a section only when its value is set, and an inverted one only when it is not', () => {
    const source =
      '{{count}} {{#one}}customer was{{/one}}{{^one}}customers were{{/one}} missed';
    expect(renderTemplate(source, { count: '1', one: 'yes' })).toBe(
      '1 customer was missed',
    );
    expect(renderTemplate(source, { count: '3', one: '' })).toBe(
      '3 customers were missed',
    );
  });

  it('nests sections', () => {
    const source =
      '{{#name}}to {{name}}{{#difference}} ({{difference}}){{/difference}}{{/name}}';
    expect(renderTemplate(source, { name: 'Ravi', difference: '₹20.00' })).toBe(
      'to Ravi (₹20.00)',
    );
    expect(renderTemplate(source, { name: 'Ravi', difference: '' })).toBe(
      'to Ravi',
    );
    expect(renderTemplate(source, { name: '', difference: '₹20.00' })).toBe('');
  });

  it('never escapes — the output is plain text, escaped once by the email layout', () => {
    expect(renderTemplate('{{name}}', { name: '<b>&' })).toBe('<b>&');
  });

  it('refuses a placeholder the message does not offer, by name', () => {
    expect(parseTemplate('Hi {{customer}}', known)).toEqual({
      problem: { issue: '{{customer}} is not a placeholder of this message' },
    });
  });

  it('refuses an unclosed section, a stray close and a mismatched close', () => {
    expect(parseTemplate('{{#one}}x', known)).toEqual({
      problem: { issue: '{{#one}} is never closed with {{/one}}' },
    });
    expect(parseTemplate('x{{/one}}', known)).toEqual({
      problem: { issue: '{{/one}} closes a section that was never opened' },
    });
    expect(parseTemplate('{{#one}}{{#name}}{{/one}}{{/name}}', known)).toEqual({
      problem: { issue: '{{/one}} closes {{#name}}; close {{/name}} first' },
    });
  });

  it('refuses braces that are not a placeholder', () => {
    for (const source of [
      '{{ }}',
      '{{1x}}',
      'Hi {{name',
      'Hi name}}',
      '{{na-me}}',
    ]) {
      expect(parseTemplate(source, known)).toEqual({
        problem: { issue: 'a placeholder is not written as {{name}}' },
      });
    }
  });

  it('renders a placeholder dropped from the catalogue as nothing, never throwing', () => {
    expect(
      renderTemplate('Hi {{gone}}{{#gone}} x{{/gone}}!', { name: 'Meena' }),
    ).toBe('Hi !');
    expect(renderTemplate('Hi {{name', { name: 'Meena' })).toBe('Hi {{name');
  });
});
