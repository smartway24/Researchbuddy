/**
 * A small, dependency-free XML reader.
 *
 * PubMed's efetch only speaks XML, and pulling a full parser into a React
 * Native bundle for one endpoint is not worth it. This handles the subset
 * PubMed emits: nested elements, attributes, CDATA, comments, entities, and
 * self-closing tags. It is deliberately tolerant — malformed markup yields a
 * partial tree rather than an exception, because a half-parsed record is more
 * useful to a reader than a failed search.
 */
export interface XmlNode {
  name: string;
  attributes: Record<string, string>;
  children: XmlNode[];
  /** Direct text content of this element, with entities decoded. */
  text: string;
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

export function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      const code = Number.parseInt(entity.slice(2), 16);
      return Number.isNaN(code) ? match : String.fromCodePoint(code);
    }
    if (entity.startsWith('#')) {
      const code = Number.parseInt(entity.slice(1), 10);
      return Number.isNaN(code) ? match : String.fromCodePoint(code);
    }
    return ENTITIES[entity.toLowerCase()] ?? match;
  });
}

export function parseXml(input: string): XmlNode {
  const root: XmlNode = { name: '#document', attributes: {}, children: [], text: '' };
  const stack: XmlNode[] = [root];
  let index = 0;

  const current = (): XmlNode => stack[stack.length - 1] as XmlNode;

  while (index < input.length) {
    const open = input.indexOf('<', index);
    if (open === -1) {
      current().text += decodeEntities(input.slice(index));
      break;
    }
    if (open > index) current().text += decodeEntities(input.slice(index, open));

    if (input.startsWith('<!--', open)) {
      const end = input.indexOf('-->', open);
      index = end === -1 ? input.length : end + 3;
      continue;
    }
    if (input.startsWith('<![CDATA[', open)) {
      const end = input.indexOf(']]>', open);
      const stop = end === -1 ? input.length : end;
      current().text += input.slice(open + 9, stop);
      index = end === -1 ? input.length : end + 3;
      continue;
    }
    if (input.startsWith('<?', open) || input.startsWith('<!', open)) {
      const end = input.indexOf('>', open);
      index = end === -1 ? input.length : end + 1;
      continue;
    }

    const close = findTagEnd(input, open);
    if (close === -1) break;
    const raw = input.slice(open + 1, close).trim();

    if (raw.startsWith('/')) {
      const name = raw.slice(1).trim();
      // Pop to the matching element; ignore stray closers.
      for (let depth = stack.length - 1; depth > 0; depth--) {
        if (stack[depth]?.name === name) {
          stack.length = depth;
          break;
        }
      }
      index = close + 1;
      continue;
    }

    const selfClosing = raw.endsWith('/');
    const body = selfClosing ? raw.slice(0, -1).trim() : raw;
    const nameMatch = /^[^\s/>]+/.exec(body);
    if (!nameMatch) {
      index = close + 1;
      continue;
    }
    const node: XmlNode = {
      name: nameMatch[0],
      attributes: parseAttributes(body.slice(nameMatch[0].length)),
      children: [],
      text: '',
    };
    current().children.push(node);
    if (!selfClosing) stack.push(node);
    index = close + 1;
  }

  return root;
}

/** Find the `>` that ends a tag, skipping any inside quoted attribute values. */
function findTagEnd(input: string, start: number): number {
  let quote: string | null = null;
  for (let i = start + 1; i < input.length; i++) {
    const char = input[i] as string;
    if (quote) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '>') {
      return i;
    }
  }
  return -1;
}

function parseAttributes(input: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const pattern = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(input)) !== null) {
    const name = match[1];
    if (name) attributes[name] = decodeEntities(match[3] ?? match[4] ?? '');
  }
  return attributes;
}

/** Direct children with the given tag name. */
export function childrenNamed(node: XmlNode, name: string): XmlNode[] {
  return node.children.filter((child) => child.name === name);
}

export function firstNamed(node: XmlNode, name: string): XmlNode | undefined {
  return node.children.find((child) => child.name === name);
}

/** Depth-first search for every descendant with the given tag name. */
export function findAll(node: XmlNode, name: string): XmlNode[] {
  const found: XmlNode[] = [];
  const walk = (current: XmlNode): void => {
    for (const child of current.children) {
      if (child.name === name) found.push(child);
      walk(child);
    }
  };
  walk(node);
  return found;
}

export function findFirst(node: XmlNode, name: string): XmlNode | undefined {
  for (const child of node.children) {
    if (child.name === name) return child;
    const nested = findFirst(child, name);
    if (nested) return nested;
  }
  return undefined;
}

/** All text in an element and its descendants, whitespace-normalised. */
export function textContent(node: XmlNode | undefined): string {
  if (!node) return '';
  let text = node.text;
  for (const child of node.children) text += ` ${textContent(child)}`;
  return text.replace(/\s+/g, ' ').trim();
}
