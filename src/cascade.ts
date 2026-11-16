/**
 * Style cascade checks for `.4DForm` files. 4D follows the CSS 2.1 cascade, the attributes written
 * in the form JSON acting like an inline `style` attribute: they beat every style sheet rule that is
 * not `!important`, whatever its specificity, even when their value is the default one ("automatic").
 * Listbox columns, headers and footers inherit some attributes from their listbox, unless they set
 * them in their own JSON.
 * No VS Code dependency, so it can be unit tested like `validator.ts`.
 */

import { Node, getNodeValue } from 'jsonc-parser';
import { parseStylesheet, splitSelectorList } from './parser';
import { CSS_ALIASES, EDITOR_GEOMETRY, FORBIDDEN_ATTRIBUTES } from './schema';
import type { StyleSheetSource } from './cssClasses';
import type { Issue } from './formValidator';

/** Attributes a listbox column, header or footer takes from its listbox when it does not set them. */
const INHERITED_FROM_LISTBOX = new Set([
  'fontFamily',
  'fontTheme',
  'fontSize',
  'stroke',
  'textAlign',
  'verticalAlign',
  'fontWeight',
  'fontStyle',
  'textDecoration'
]);

/**
 * `fontFamily` and `fontTheme` both set the font and compete as a single attribute: either one written
 * in the form beats either one from a style sheet, and `fontFamily` wins when the form sets both.
 */
const FONT_ATTRIBUTES = ['fontFamily', 'fontTheme'];

/** Attributes competing with `key` in the cascade. */
function rivals(key: string): string[] {
  return FONT_ATTRIBUTES.includes(key) ? FONT_ATTRIBUTES : [key];
}

interface Element {
  type: string;
  name?: string;
  classes: string[];
  node: Node;
  values: Record<string, unknown>;
  /** The listbox of a column, header or footer. */
  listbox?: Element;
}

interface AttributeTest {
  name: string;
  operator?: string;
  value: string;
}

interface Compound {
  type?: string;
  ids: string[];
  classes: string[];
  attributes: AttributeTest[];
}

/** A declaration of a style sheet, with what the cascade needs to rank it. */
interface Candidate {
  compound: Compound;
  selector: string;
  /** Attribute name in the form JSON (CSS aliases resolved). */
  property: string;
  /** Value as written in the style sheet. */
  value: string;
  /** Declaration as written in the style sheet, e.g. `color: red`. */
  source: string;
  important: boolean;
  /** CSS 2.1 specificity without the inline part: [ids, classes and attributes, types]. */
  specificity: [number, number, number];
  /** Position in the loading order of the style sheets. */
  order: number;
  conditions: string[];
  sheet: StyleSheetSource;
  offset: number;
  length: number;
}

/** Reports, for the objects of a page, the form attributes that keep a style sheet value from applying. */
export function cascadeIssues(objects: Node, sheets: StyleSheetSource[]): Issue[] {
  const candidates = styleSheetCandidates(sheets);

  const issues: Issue[] = [];
  for (const element of formElements(objects)) {
    const matching = candidates.filter(candidate => matches(candidate.compound, element));
    const overridden = new Set<string>();
    const fontThemeIgnored = 'fontFamily' in element.values && 'fontTheme' in element.values;

    for (const { key, keyNode } of members(element.node)) {
      if (FORBIDDEN_ATTRIBUTES.has(key)) continue;
      if (key === 'fontTheme' && fontThemeIgnored) {
        issues.push({
          message: '"fontTheme" is ignored because "fontFamily" is also set: use one or the other.',
          offset: keyNode.offset + 1,
          length: key.length,
          severity: 'info',
          code: 'fontThemeIgnored'
        });
        continue;
      }
      const declarations = matching.filter(candidate => rivals(key).includes(candidate.property));
      // An !important declaration applying everywhere wins over the form: nothing is hidden by it.
      if (declarations.some(candidate => candidate.important && always(candidate))) continue;
      const hidden = declarations.filter(candidate => !candidate.important);
      if (!hidden.length) continue;

      overridden.add(key);
      const winner = hidden.reduce((best, candidate) => (compare(candidate, best) > 0 ? candidate : best));
      const others = hidden.length - 1;
      const andOthers = others ? ` (and ${others} other declaration${others > 1 ? 's' : ''})` : '';
      if (EDITOR_GEOMETRY.has(key)) {
        // Removing the attribute is pointless: the form editor writes it again on the next save.
        issues.push({
          message:
            `"${winner.source}" from ${describe(winner)}${andOthers} does not apply: the 4D form editor always ` +
            `writes "${key}" in the form, so the style sheet value must be declared !important.`,
          offset: keyNode.offset + 1,
          length: key.length,
          severity: 'info',
          code: 'geometryOverride',
          related: related(winner, 'Declaration to make !important')
        });
        continue;
      }
      const duplicate = repeats(key, element.values[key], hidden);
      issues.push({
        message: duplicate
          ? `"${key}" repeats "${winner.source}" from ${describe(winner)}${andOthers}: remove it so that ` +
            'later changes to the style sheet apply to this object.'
          : `"${key}" set in the form overrides "${winner.source}" from ${describe(winner)}${andOthers}: ` +
            'attributes written in the form take precedence over style sheets unless declared !important.',
        offset: keyNode.offset + 1,
        length: key.length,
        severity: 'info',
        code: duplicate ? 'cssDuplicate' : 'cssOverride',
        related: related(winner, 'Overridden declaration')
      });
    }

    if (!element.listbox) continue;
    const listboxMatching = candidates.filter(candidate => matches(candidate.compound, element.listbox!));
    for (const { key, keyNode } of members(element.node)) {
      if (!INHERITED_FROM_LISTBOX.has(key) || overridden.has(key)) continue;
      if (key === 'fontTheme' && fontThemeIgnored) continue;
      const providers = styleSheetDeclarations(element.listbox, key, listboxMatching);
      if (!providers.length) continue;
      const inherited = providers.reduce((best, candidate) => (compare(candidate, best) > 0 ? candidate : best));
      const duplicate = repeats(key, element.values[key], providers);
      issues.push({
        message: duplicate
          ? `"${key}" repeats "${inherited.source}" that the listbox gets from ${describe(inherited)}: remove it ` +
            `so that this ${element.type} keeps following the listbox when the style sheet changes.`
          : `"${key}" set on this ${element.type} prevents it from inheriting "${inherited.source}" that the ` +
            `listbox gets from ${describe(inherited)}. Any value written here, even "automatic", blocks the inheritance.`,
        offset: keyNode.offset + 1,
        length: key.length,
        severity: 'info',
        code: duplicate ? 'inheritedDuplicate' : 'inheritanceBlocked',
        related: related(inherited, 'Listbox declaration')
      });
    }
  }
  return issues;
}

/** Declarations that can give `element` its value for `property` from a style sheet. */
function styleSheetDeclarations(element: Element, property: string, matching: Candidate[]): Candidate[] {
  const inForm = rivals(property).some(name => name in element.values);
  return matching.filter(candidate => rivals(property).includes(candidate.property) && (!inForm || candidate.important));
}

/**
 * True when removing the form attribute changes nothing: every declaration that would take over
 * sets the same attribute to the same value, and one of them applies on every platform and media.
 */
function repeats(key: string, value: unknown, declarations: Candidate[]): boolean {
  const expected = comparable(value);
  return (
    expected !== undefined &&
    declarations.some(always) &&
    declarations.every(candidate => candidate.property === key && comparable(candidate.value) === expected)
  );
}

/** Declaration applying whatever the platform and the media. */
function always(candidate: Candidate): boolean {
  return !candidate.conditions.length && !candidate.sheet.platform;
}

/**
 * Form or style sheet value in a form where equal values compare equal: `18px` and `18`,
 * `#f00` and `#FF0000`, `rgb(255, 0, 0)` and `#FF0000`. Other values are compared as written.
 */
function comparable(value: unknown): string | undefined {
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value !== 'string') return undefined;
  const text = value.trim().replace(/^(["'])(.*)\1$/, '$2');
  const number = text.match(/^(-?\d+(?:\.\d+)?)(px)?$/i);
  if (number) return String(Number(number[1]));
  const short = text.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toUpperCase();
  if (/^#[0-9a-f]{6}$/i.test(text)) return text.toUpperCase();
  const rgb = text.match(/^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i);
  if (rgb) return `#${rgb.slice(1).map(part => Number(part).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
  return text;
}

/** Cascade order: !important first, then specificity, then the last declared. */
function compare(a: Candidate, b: Candidate): number {
  if (a.important !== b.important) return a.important ? 1 : -1;
  for (let i = 0; i < 3; i++) {
    if (a.specificity[i] !== b.specificity[i]) return a.specificity[i] - b.specificity[i];
  }
  return a.order - b.order;
}

function describe(candidate: Candidate): string {
  const line = lineAndCharacter(candidate.sheet.text, candidate.offset).line + 1;
  const media =
    (candidate.conditions.length ? ` inside "${candidate.conditions.join(' ')}"` : '') +
    (candidate.sheet.platform ? ` (${candidate.sheet.platform} only)` : '');
  return `"${candidate.selector}" (${candidate.sheet.label}:${line})${media}`;
}

function related(candidate: Candidate, message: string): Issue['related'] {
  return {
    file: candidate.sheet.file,
    ...lineAndCharacter(candidate.sheet.text, candidate.offset),
    length: candidate.length,
    message
  };
}

function lineAndCharacter(text: string, offset: number): { line: number; character: number } {
  const before = text.slice(0, offset);
  const lineStart = before.lastIndexOf('\n') + 1;
  return { line: before.split('\n').length - 1, character: offset - lineStart };
}

function styleSheetCandidates(sheets: StyleSheetSource[]): Candidate[] {
  const candidates: Candidate[] = [];
  let order = 0;
  for (const sheet of sheets) {
    for (const rule of parseStylesheet(sheet.text).rules) {
      for (const group of splitSelectorList(rule.selector, rule.selectorOffset)) {
        const compound = parseCompound(group.text);
        if (!compound) continue;
        const specificity: [number, number, number] = [
          compound.ids.length,
          compound.classes.length + compound.attributes.length,
          compound.type ? 1 : 0
        ];
        for (const declaration of rule.declarations) {
          if (!declaration.value) continue;
          const end = declaration.valueOffset + declaration.value.length;
          candidates.push({
            compound,
            selector: group.text,
            property: CSS_ALIASES.get(declaration.property) ?? declaration.property,
            value: declaration.value,
            source: `${declaration.property}: ${declaration.value}`,
            important: declaration.important,
            specificity,
            order: order++,
            conditions: rule.conditions,
            sheet,
            offset: declaration.propertyOffset,
            length: end - declaration.propertyOffset
          });
        }
      }
    }
  }
  return candidates;
}

/**
 * Parses a selector made of a single compound (`button.red#ok[text=Hello]`). Selectors with
 * combinators or anything else 4D does not document are ignored rather than guessed.
 */
function parseCompound(text: string): Compound | undefined {
  const compound: Compound = { ids: [], classes: [], attributes: [] };
  let i = 0;
  while (i < text.length) {
    const char = text[i];
    if (char === '*') {
      i++;
      continue;
    }
    if (char === '.' || char === '#') {
      const name = text.slice(i + 1).match(/^-?[A-Za-z_][\w-]*/)?.[0];
      if (!name) return undefined;
      (char === '.' ? compound.classes : compound.ids).push(name);
      i += name.length + 1;
      continue;
    }
    if (char === '[') {
      const end = text.indexOf(']', i);
      const match = end < 0 ? null : text.slice(i + 1, end).match(/^\s*([A-Za-z_][\w-]*)\s*(?:([~|^$*]?=)\s*(.*?)\s*)?$/);
      if (!match) return undefined;
      compound.attributes.push({ name: match[1], operator: match[2], value: (match[3] ?? '').replace(/^(["'])(.*)\1$/, '$2') });
      i = end + 1;
      continue;
    }
    const type = i === 0 ? text.match(/^[A-Za-z_][\w-]*/)?.[0] : undefined;
    if (!type) return undefined;
    compound.type = type;
    i += type.length;
  }
  return compound;
}

function matches(compound: Compound, element: Element): boolean {
  if (compound.type && compound.type !== element.type) return false;
  if (compound.ids.some(id => id !== element.name)) return false;
  if (compound.classes.some(name => !element.classes.includes(name))) return false;
  return compound.attributes.every(test => matchesAttribute(test, element.values[test.name]));
}

function matchesAttribute(test: AttributeTest, raw: unknown): boolean {
  if (raw === undefined) return false;
  if (!test.operator) return true;
  if (typeof raw === 'object' && raw !== null) return false;
  const value = String(raw);
  switch (test.operator) {
    case '=':
      return value === test.value;
    case '~=':
      return value.split(/\s+/).includes(test.value);
    case '|=':
      return value === test.value || value.startsWith(`${test.value}-`);
    case '^=':
      return value.startsWith(test.value);
    case '$=':
      return value.endsWith(test.value);
    case '*=':
      return value.includes(test.value);
  }
  return false;
}

/** Objects of a page "objects" node, with the columns, headers and footers of its listboxes. */
function formElements(objects: Node): Element[] {
  const elements: Element[] = [];
  for (const { key, valueNode } of members(objects)) {
    const object = element(valueNode, key);
    if (!object) continue;
    elements.push(object);
    if (object.type !== 'listbox') continue;

    const columns = members(valueNode).find(member => member.key === 'columns')?.valueNode;
    for (const columnNode of columns?.type === 'array' ? columns.children ?? [] : []) {
      const column = element(columnNode, undefined, 'column', object);
      if (!column) continue;
      elements.push(column);
      for (const part of ['header', 'footer']) {
        const partNode = members(columnNode).find(member => member.key === part)?.valueNode;
        const inner = partNode && element(partNode, undefined, part, object);
        if (inner) elements.push(inner);
      }
    }
  }
  return elements;
}

function element(node: Node, name?: string, type?: string, listbox?: Element): Element | undefined {
  if (node.type !== 'object') return undefined;
  const values = getNodeValue(node) as Record<string, unknown>;
  const objectType = type ?? values.type;
  if (typeof objectType !== 'string') return undefined;
  return {
    type: objectType,
    name: name ?? (typeof values.name === 'string' ? values.name : undefined),
    classes: typeof values.class === 'string' ? values.class.split(/\s+/).filter(Boolean) : [],
    node,
    values,
    listbox
  };
}

function members(node: Node): { key: string; keyNode: Node; valueNode: Node }[] {
  if (node.type !== 'object' || !node.children) return [];
  return node.children
    .map(property => ({
      key: String(property.children?.[0]?.value ?? ''),
      keyNode: property.children?.[0] as Node,
      valueNode: property.children?.[1] as Node
    }))
    .filter(property => property.keyNode && property.valueNode);
}
