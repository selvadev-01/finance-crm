/**
 * The placeholder language of notification templates (US-074). Deliberately
 * small — a Super Admin writes these in a settings form, not a code editor:
 *
 * - `{{name}}` — the value of `name`
 * - `{{#name}}…{{/name}}` — the text between, only when `name` has a value
 * - `{{^name}}…{{/name}}` — the text between, only when `name` has none
 *
 * Sections are how one template says "1 customer was" and "3 customers
 * were", or adds "(₹20.00 against the record)" only when there is a
 * difference — in any language, without the code composing English phrases.
 *
 * Every value is a string the caller has already formatted (money through
 * `rupees`, dates as `14 Sep 2026`), so nothing here formats a number, and
 * nothing here escapes HTML: the output is plain text, and the email layout
 * escapes it once, where it becomes HTML.
 *
 * `parse` is strict, for saving: an unknown placeholder or an unclosed section
 * is refused. `render` is total, for sending: it runs inside the transaction
 * of a collection or a handover, so it never throws — a template saved under
 * an older catalogue renders a placeholder that no longer exists as nothing.
 */

export type TemplateValues = Readonly<Record<string, string>>;

type Node =
  | { kind: 'text'; text: string }
  | { kind: 'value'; name: string }
  | { kind: 'section'; name: string; inverted: boolean; children: Node[] };

export interface TemplateProblem {
  issue: string;
}

const TAG = /\{\{\s*([#^/]?)\s*([A-Za-z][A-Za-z0-9]*)\s*\}\}/g;

/**
 * The template as a tree, or the first problem with it. `known` is the set of
 * placeholders this message offers; anything else is refused by name, so a
 * typo like `{{customer}}` is caught when saving, not by a blank in a push.
 */
export function parseTemplate(
  source: string,
  known: ReadonlySet<string>,
): { nodes: Node[] } | { problem: TemplateProblem } {
  const root: Node[] = [];
  const stack: { name: string; children: Node[] }[] = [];
  const current = () => stack.at(-1)?.children ?? root;
  let last = 0;

  for (const match of source.matchAll(TAG)) {
    const before = source.slice(last, match.index);
    const stray = strayBraces(before);
    if (stray) return { problem: stray };
    if (before) current().push({ kind: 'text', text: before });
    last = match.index + match[0].length;

    const [, sigil = '', name = ''] = match;
    if (!known.has(name)) {
      return { problem: { issue: `{{${name}}} is not a placeholder of this message` } };
    }
    if (sigil === '') {
      current().push({ kind: 'value', name });
    } else if (sigil === '/') {
      const open = stack.pop();
      if (!open) {
        return { problem: { issue: `{{/${name}}} closes a section that was never opened` } };
      }
      if (open.name !== name) {
        return {
          problem: { issue: `{{/${name}}} closes {{#${open.name}}}; close {{/${open.name}}} first` },
        };
      }
    } else {
      const section: Node = {
        kind: 'section',
        name,
        inverted: sigil === '^',
        children: [],
      };
      current().push(section);
      stack.push({ name, children: section.children });
    }
  }

  const rest = source.slice(last);
  const stray = strayBraces(rest);
  if (stray) return { problem: stray };
  if (rest) current().push({ kind: 'text', text: rest });

  const unclosed = stack.at(-1);
  if (unclosed) {
    return { problem: { issue: `{{#${unclosed.name}}} is never closed with {{/${unclosed.name}}}` } };
  }
  return { nodes: root };
}

/** `{{` or `}}` left over once every well-formed tag has been read. */
function strayBraces(text: string): TemplateProblem | null {
  return text.includes('{{') || text.includes('}}')
    ? { issue: 'a placeholder is not written as {{name}}' }
    : null;
}

/**
 * The text, with every placeholder filled. Total: an unknown name renders as
 * nothing and a malformed template renders as written, braces and all —
 * neither can happen to a template that `parseTemplate` accepted.
 */
export function renderTemplate(source: string, values: TemplateValues): string {
  const parsed = parseTemplate(source, new Set(Object.keys(values)));
  if ('nodes' in parsed) return renderNodes(parsed.nodes, values);
  // Saved under an older catalogue: render what can be rendered, drop the rest.
  const lenient = parseTemplate(source, ANY_NAME);
  return 'nodes' in lenient ? renderNodes(lenient.nodes, values) : source;
}

/** Accepts every name — the lenient half of `renderTemplate`. */
const ANY_NAME: ReadonlySet<string> = new (class extends Set<string> {
  override has(): boolean {
    return true;
  }
})();

function renderNodes(nodes: Node[], values: TemplateValues): string {
  return nodes
    .map((node) => {
      switch (node.kind) {
        case 'text':
          return node.text;
        case 'value':
          return values[node.name] ?? '';
        case 'section': {
          const present = (values[node.name] ?? '') !== '';
          return present !== node.inverted
            ? renderNodes(node.children, values)
            : '';
        }
      }
    })
    .join('');
}
