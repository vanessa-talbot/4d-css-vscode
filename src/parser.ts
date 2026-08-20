/**
 * Minimal CSS parser tailored for 4D style sheets: rules, declarations and
 * (possibly nested) `@media` blocks, with absolute offsets kept for diagnostics.
 */

export interface Declaration {
  property: string;
  propertyOffset: number;
  value: string;
  valueOffset: number;
  important: boolean;
}

export interface Rule {
  selector: string;
  selectorOffset: number;
  bodyStart: number;
  bodyEnd: number;
  declarations: Declaration[];
}

export interface AtRule {
  name: string;
  prelude: string;
  preludeOffset: number;
}

export interface ParseIssue {
  message: string;
  offset: number;
  length: number;
}

export interface Stylesheet {
  rules: Rule[];
  atRules: AtRule[];
  issues: ParseIssue[];
}

/** Replaces comments with spaces so that offsets stay valid. */
export function stripComments(text: string): string {
  let result = '';
  let i = 0;
  while (i < text.length) {
    const char = text[i];
    if (char === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end < 0 ? text.length : end + 2;
      result += blank(text.slice(i, stop));
      i = stop;
      continue;
    }
    if (char === '"' || char === "'") {
      const end = findStringEnd(text, i);
      result += text.slice(i, end);
      i = end;
      continue;
    }
    result += char;
    i++;
  }
  return result;
}

function blank(source: string): string {
  return source.replace(/[^\n]/g, ' ');
}

function findStringEnd(text: string, start: number): number {
  const quote = text[start];
  let i = start + 1;
  while (i < text.length) {
    if (text[i] === '\\') {
      i += 2;
      continue;
    }
    if (text[i] === quote) return i + 1;
    if (text[i] === '\n') return i;
    i++;
  }
  return i;
}

export function parseStylesheet(source: string): Stylesheet {
  const text = stripComments(source);
  const sheet: Stylesheet = { rules: [], atRules: [], issues: [] };
  parseBlock(text, 0, text.length, sheet);
  return sheet;
}

function parseBlock(text: string, start: number, end: number, sheet: Stylesheet): void {
  let i = start;
  while (i < end) {
    while (i < end && /\s/.test(text[i])) i++;
    if (i >= end) break;
    if (text[i] === '}') {
      i++;
      continue;
    }

    const preludeStart = i;
    i = scanUntil(text, i, end, ch => ch === '{' || ch === ';' || ch === '}');
    const prelude = text.slice(preludeStart, i);

    if (i >= end || text[i] !== '{') {
      if (prelude.trim()) {
        sheet.issues.push({
          message: 'Expected "{" after the selector.',
          offset: preludeStart,
          length: Math.max(prelude.trimEnd().length, 1)
        });
      }
      i++;
      continue;
    }

    const bodyStart = i + 1;
    const bodyEnd = findBlockEnd(text, bodyStart, end);
    const trimmed = prelude.trim();

    if (trimmed.startsWith('@')) {
      const name = trimmed.slice(1).split(/[\s({]/, 1)[0];
      const preludeOffset = preludeStart + prelude.indexOf(trimmed);
      sheet.atRules.push({ name, prelude: trimmed, preludeOffset });
      parseBlock(text, bodyStart, bodyEnd, sheet);
    } else {
      sheet.rules.push({
        selector: trimmed,
        selectorOffset: preludeStart + prelude.indexOf(trimmed),
        bodyStart,
        bodyEnd,
        declarations: parseDeclarations(text, bodyStart, bodyEnd)
      });
    }
    i = bodyEnd + 1;
  }
}

function parseDeclarations(text: string, start: number, end: number): Declaration[] {
  const declarations: Declaration[] = [];
  let i = start;
  while (i < end) {
    while (i < end && (/\s/.test(text[i]) || text[i] === ';')) i++;
    if (i >= end) break;
    if (text[i] === '{') {
      i = findBlockEnd(text, i + 1, end) + 1;
      continue;
    }
    if (text[i] === '}') break;

    const segmentStart = i;
    i = scanUntil(text, i, end, ch => ch === ';' || ch === '{' || ch === '}');
    const segment = text.slice(segmentStart, i);
    const declaration = parseDeclaration(segment, segmentStart);
    if (declaration) declarations.push(declaration);
    if (i < end && text[i] === '{') i = findBlockEnd(text, i + 1, end) + 1;
  }
  return declarations;
}

function parseDeclaration(segment: string, offset: number): Declaration | undefined {
  const colon = indexOfTopLevel(segment, ':');
  if (colon < 0) {
    const property = segment.trim();
    if (!property) return undefined;
    return {
      property,
      propertyOffset: offset + segment.indexOf(property),
      value: '',
      valueOffset: offset + segment.length,
      important: false
    };
  }

  const rawProperty = segment.slice(0, colon);
  const property = rawProperty.trim();
  let rawValue = segment.slice(colon + 1);
  let valueOffset = offset + colon + 1;

  const important = /!\s*important\s*$/i.test(rawValue);
  if (important) rawValue = rawValue.replace(/!\s*important\s*$/i, '');

  const value = rawValue.trim();
  valueOffset += value ? rawValue.indexOf(value) : rawValue.length;

  return {
    property,
    propertyOffset: offset + rawProperty.indexOf(property),
    value,
    valueOffset,
    important
  };
}

/** Advances past strings, parentheses and brackets until `stop` matches at top level. */
function scanUntil(text: string, start: number, end: number, stop: (char: string) => boolean): number {
  let i = start;
  let depth = 0;
  while (i < end) {
    const char = text[i];
    if (char === '"' || char === "'") {
      i = findStringEnd(text, i);
      continue;
    }
    if (char === '(' || char === '[') depth++;
    else if (char === ')' || char === ']') depth = Math.max(0, depth - 1);
    else if (depth === 0 && stop(char)) return i;
    i++;
  }
  return end;
}

/** Returns the offset of the "}" closing the block opened before `start`. */
function findBlockEnd(text: string, start: number, end: number): number {
  let i = start;
  let depth = 0;
  while (i < end) {
    const char = text[i];
    if (char === '"' || char === "'") {
      i = findStringEnd(text, i);
      continue;
    }
    if (char === '{') depth++;
    else if (char === '}') {
      if (depth === 0) return i;
      depth--;
    }
    i++;
  }
  return end;
}

function indexOfTopLevel(text: string, target: string): number {
  const index = scanUntil(text, 0, text.length, char => char === target);
  return index >= text.length ? -1 : index;
}

/** Splits a selector list on top level commas, keeping offsets. */
export function splitSelectorList(selector: string, offset: number): { text: string; offset: number }[] {
  const parts: { text: string; offset: number }[] = [];
  let i = 0;
  while (i <= selector.length) {
    const start = i;
    const stop = scanUntil(selector, i, selector.length, char => char === ',');
    const raw = selector.slice(start, stop);
    const trimmed = raw.trim();
    if (trimmed) parts.push({ text: trimmed, offset: offset + start + raw.indexOf(trimmed) });
    i = stop + 1;
  }
  return parts;
}
