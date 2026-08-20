/**
 * Semantic checks for 4D style sheets: selectors, attribute names and values.
 */

import { ParseIssue, Stylesheet, splitSelectorList } from './parser';
import {
  CSS_ALIASES,
  CSS_ALIAS_VALUES,
  FORBIDDEN_ATTRIBUTES,
  MEDIA_FEATURES,
  ObjectIndex,
  PropertyInfo
} from './schema';

export type Severity = 'error' | 'warning';

export interface Issue extends ParseIssue {
  severity: Severity;
}

const UNITS = /^[-+]?\d+(?:\.\d+)?(?:px|em|pt|%|in|mm|cm)?$/;
const NUMERIC_TYPES = new Set(['integer', 'number']);

export function validateStylesheet(sheet: Stylesheet, index: ObjectIndex): Issue[] {
  const issues: Issue[] = sheet.issues.map(issue => ({ ...issue, severity: 'error' as Severity }));

  for (const atRule of sheet.atRules) issues.push(...validateAtRule(atRule.name, atRule.prelude, atRule.preludeOffset));

  for (const rule of sheet.rules) {
    const selector = analyzeSelector(rule.selector, rule.selectorOffset, index);
    issues.push(...selector.issues);

    const allowed = allowedProperties(index, selector.types);
    for (const declaration of rule.declarations) {
      issues.push(...validateDeclaration(declaration, allowed, selector.types));
    }
  }
  return issues;
}

function validateAtRule(name: string, prelude: string, offset: number): Issue[] {
  const issues: Issue[] = [];
  if (name !== 'media') {
    issues.push({
      message: `"@${name}" is not supported in 4D style sheets. Only "@media" is.`,
      offset,
      length: name.length + 1,
      severity: 'error'
    });
    return issues;
  }

  const feature = /\(\s*([A-Za-z-]+)\s*:\s*([^)]*)\)/g;
  let match: RegExpExecArray | null;
  let found = false;
  while ((match = feature.exec(prelude))) {
    found = true;
    const values = MEDIA_FEATURES.get(match[1]);
    if (!values) {
      issues.push({
        message: `Unknown media feature "${match[1]}". Expected: ${[...MEDIA_FEATURES.keys()].join(', ')}.`,
        offset: offset + match.index + match[0].indexOf(match[1]),
        length: match[1].length,
        severity: 'warning'
      });
      continue;
    }
    const value = match[2].trim();
    if (value && !values.includes(value)) {
      issues.push({
        message: `Invalid value "${value}" for "${match[1]}". Expected: ${values.join(', ')}.`,
        offset: offset + match.index + match[0].lastIndexOf(value),
        length: value.length,
        severity: 'warning'
      });
    }
  }
  if (!found) {
    issues.push({
      message: 'Expected a media feature such as "(prefers-color-scheme: dark)".',
      offset,
      length: prelude.length,
      severity: 'warning'
    });
  }
  return issues;
}

export interface SelectorAnalysis {
  /** Object types targeted by the selector. Empty means "any object". */
  types: string[];
  issues: Issue[];
}

export function analyzeSelector(selector: string, offset: number, index: ObjectIndex): SelectorAnalysis {
  const types: string[] = [];
  const issues: Issue[] = [];

  for (const group of splitSelectorList(selector, offset)) {
    const text = group.text;
    let i = 0;
    let unitStart = true;
    while (i < text.length) {
      const char = text[i];
      if (/\s/.test(char) || '>+~'.includes(char)) {
        i++;
        unitStart = true;
        continue;
      }
      if (char === '*') {
        i++;
        unitStart = false;
        continue;
      }
      if (char === '.' || char === '#') {
        const name = readIdentifier(text, i + 1);
        if (!name) {
          issues.push(issue(`Expected a name after "${char}".`, group.offset + i, 1, 'error'));
          i++;
        } else i += name.length + 1;
        unitStart = false;
        continue;
      }
      if (char === '[') {
        const end = text.indexOf(']', i);
        const stop = end < 0 ? text.length : end;
        const body = text.slice(i + 1, stop);
        issues.push(...validateAttributeSelector(body, group.offset + i + 1, index, types));
        if (end < 0) issues.push(issue('Unclosed attribute selector.', group.offset + i, 1, 'error'));
        i = stop + 1;
        unitStart = false;
        continue;
      }
      const identifier = readIdentifier(text, i);
      if (identifier) {
        if (unitStart) {
          if (index.has(identifier)) types.push(identifier);
          else {
            issues.push(
              issue(`Unknown 4D object type "${identifier}".`, group.offset + i, identifier.length, 'error')
            );
          }
        } else {
          issues.push(issue(`Unexpected "${identifier}" in selector.`, group.offset + i, identifier.length, 'error'));
        }
        i += identifier.length;
        unitStart = false;
        continue;
      }
      issues.push(issue(`Unexpected character "${char}" in selector.`, group.offset + i, 1, 'error'));
      i++;
      unitStart = false;
    }
  }
  return { types: [...new Set(types)], issues };
}

function validateAttributeSelector(
  body: string,
  offset: number,
  index: ObjectIndex,
  types: string[]
): Issue[] {
  const issues: Issue[] = [];
  const match = body.match(/^\s*([A-Za-z_][\w-]*)\s*(?:([~|^$*]?=)\s*(.*?)\s*)?$/);
  if (!match) {
    issues.push(issue('Invalid attribute selector.', offset, Math.max(body.length, 1), 'error'));
    return issues;
  }

  const [, attribute, operator, rawValue] = match;
  const attributeOffset = offset + body.indexOf(attribute);

  if (operator && !['=', '~=', '|='].includes(operator)) {
    issues.push(
      issue(
        `Operator "${operator}" is not supported. 4D supports "=", "~=" and "|=".`,
        offset + body.indexOf(operator),
        operator.length,
        'error'
      )
    );
  }

  if (attribute === 'type') {
    const value = unquote(rawValue ?? '');
    if (value && !index.has(value)) {
      issues.push(
        issue(`Unknown 4D object type "${value}".`, offset + body.lastIndexOf(value), value.length, 'error')
      );
    } else if (value) types.push(value);
    return issues;
  }

  if (FORBIDDEN_ATTRIBUTES.has(attribute)) return issues;

  const known = knownAttribute(index, attribute, types);
  if (!known) {
    issues.push(issue(`Unknown 4D attribute "${attribute}".`, attributeOffset, attribute.length, 'warning'));
  }
  return issues;
}

function knownAttribute(index: ObjectIndex, attribute: string, types: string[]): boolean {
  const name = CSS_ALIASES.get(attribute) ?? attribute;
  if (types.length) return types.some(type => index.get(type)?.has(name));
  for (const properties of index.values()) if (properties.has(name)) return true;
  return false;
}

export function allowedProperties(index: ObjectIndex, types: string[]): Map<string, PropertyInfo> {
  const result = new Map<string, PropertyInfo>();
  const sources = types.length
    ? types.map(type => index.get(type)).filter(Boolean) as Map<string, PropertyInfo>[]
    : [...index.values()];

  for (const properties of sources) {
    for (const [name, info] of properties) {
      const existing = result.get(name);
      if (!existing) {
        result.set(name, { ...info, enums: [...info.enums], types: [...info.types], refs: [...info.refs] });
        continue;
      }
      existing.enums = [...new Set([...existing.enums, ...info.enums])];
      existing.freeForm ||= info.freeForm;
    }
  }
  return result;
}

function validateDeclaration(
  declaration: { property: string; propertyOffset: number; value: string; valueOffset: number },
  allowed: Map<string, PropertyInfo>,
  types: string[]
): Issue[] {
  const issues: Issue[] = [];
  const { property, propertyOffset, value, valueOffset } = declaration;

  if (FORBIDDEN_ATTRIBUTES.has(property)) {
    issues.push(
      issue(
        `"${property}" cannot be defined in a 4D style sheet.`,
        propertyOffset,
        property.length,
        'error'
      )
    );
    return issues;
  }

  const resolved = CSS_ALIASES.get(property) ?? property;
  const info = allowed.get(resolved);
  if (!info) {
    const scope = types.length ? ` for ${types.join(', ')}` : '';
    issues.push(issue(`Unknown 4D attribute "${property}"${scope}.`, propertyOffset, property.length, 'error'));
    return issues;
  }

  if (!value) {
    issues.push(issue(`Missing value for "${property}".`, propertyOffset, property.length, 'error'));
    return issues;
  }

  const cssValues = CSS_ALIAS_VALUES.get(property);
  if (cssValues && !cssValues.includes(unquote(value))) {
    issues.push(
      issue(
        `"${value}" is a 4D specific value: use the 4D attribute name "${resolved}" instead of "${property}".`,
        valueOffset,
        value.length,
        'warning'
      )
    );
    return issues;
  }

  const message = checkValue(info, value);
  if (message) issues.push(issue(message, valueOffset, value.length, 'warning'));
  return issues;
}

export function checkValue(info: PropertyInfo, raw: string): string | undefined {
  const value = unquote(raw);

  if (info.refs.includes('picture')) {
    if (!/^url\(.*\)$/i.test(raw) && !isQuoted(raw)) {
      return `Expected a picture path, e.g. url("/RESOURCES/icon.png").`;
    }
    return undefined;
  }

  if (info.refs.includes('color')) return checkColor(value);

  if (info.pattern && !new RegExp(info.pattern).test(value)) {
    return `"${value}" does not match the expected format (${info.pattern}).`;
  }

  if (info.enums.length && !info.freeForm && !info.enums.includes(value)) {
    return `Invalid value "${value}". Expected one of: ${info.enums.join(', ')}.`;
  }

  if (info.enums.length) return undefined;

  const numericOnly = info.types.length > 0 && info.types.every(type => NUMERIC_TYPES.has(type));
  if (numericOnly) {
    if (!UNITS.test(value)) return `Expected a number, got "${value}".`;
    if (info.minimum !== undefined && parseFloat(value) < info.minimum) {
      return `"${value}" is lower than the minimum (${info.minimum}).`;
    }
    return undefined;
  }

  if (info.types.length === 1 && info.types[0] === 'boolean' && !/^(true|false)$/i.test(value)) {
    return `Expected "true" or "false", got "${value}".`;
  }
  return undefined;
}

export function checkColor(value: string): string | undefined {
  if (/^(transparent|automatic|automaticAlternate)$/i.test(value)) return undefined;
  if (/^#[0-9a-f]+$/i.test(value)) {
    return [4, 5, 7, 9].includes(value.length) ? undefined : `"${value}" is not a valid hexadecimal color.`;
  }
  if (/^rgba?\(\s*[\d.%\s,/]+\)$/i.test(value)) return undefined;
  if (/^[A-Za-z]+$/.test(value)) return undefined;
  return `"${value}" is not a valid color. Use a CSS color name, #RRGGBB or rgb().`;
}

function readIdentifier(text: string, start: number): string {
  const match = text.slice(start).match(/^[A-Za-z_][\w-]*/);
  return match?.[0] ?? '';
}

export function unquote(value: string): string {
  const trimmed = value.trim();
  return isQuoted(trimmed) ? trimmed.slice(1, -1) : trimmed;
}

function isQuoted(value: string): boolean {
  return value.length >= 2 && /^(".*"|'.*')$/s.test(value);
}

function issue(message: string, offset: number, length: number, severity: Severity): Issue {
  return { message, offset, length: Math.max(length, 1), severity };
}
