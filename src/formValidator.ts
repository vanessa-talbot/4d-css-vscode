/**
 * Semantic checks and completion helpers for `.4DForm` JSON files: unknown attributes,
 * unknown object types and value checks, driven by the same 4D Forms JSON Schema as the CSS side.
 * No VS Code dependency, so it can be unit tested like `validator.ts`.
 */

import { Node, Segment, findNodeAtLocation, getLocation, getNodeValue, parseTree } from 'jsonc-parser';
import { checkColor } from './validator';
import { RefResolver } from './jsonRef';
import type { FormClasses } from './cssClasses';
import { cascadeIssues } from './cascade';
import { FormIndex, PropertyInfo } from './schema';

export type Severity = 'error' | 'warning' | 'info';

export interface Issue {
  message: string;
  offset: number;
  length: number;
  severity: Severity;
  /** Identifies the issues a quick fix can handle. */
  code?: string;
  /** Location in another file (0-based line and character) explaining the issue. */
  related?: { file: string; line: number; character: number; length: number; message: string };
}

const NUMERIC_TYPES = new Set(['integer', 'number']);

/**
 * Root-level attributes written by the 4D Form editor for its own use (view state, ...).
 * Not part of the JSON Schema because they are meaningless at runtime, but not an error either.
 */
const EDITOR_ONLY_ATTRIBUTES = new Set(['editor']);

/**
 * `styleSheets` describes the style sheets the form loads; when given, the paths of the "css"
 * attribute must exist, every name of a "class" attribute must be declared in one of them, and
 * the form attributes that keep a style sheet value from applying are reported.
 */
export function validateForm(
  text: string,
  formIndex: FormIndex,
  resolveRef?: RefResolver,
  styleSheets?: FormClasses
): Issue[] {
  const issues: Issue[] = [];
  const root = parseTree(text);
  if (!root || root.type !== 'object') return issues;

  const css = objectProperties(root).find(property => property.key === 'css')?.valueNode;
  if (css && styleSheets?.missing.size) validateStyleSheetPaths(css, styleSheets.missing, issues);

  validateObject(root, formIndex.index.get('form') ?? new Map(), issues, resolveRef, EDITOR_ONLY_ATTRIBUTES);

  const pages = objectProperties(root).find(property => property.key === 'pages')?.valueNode;
  for (const page of pages?.type === 'array' ? pages.children ?? [] : []) {
    if (page.type !== 'object') continue;
    const objects = objectProperties(page).find(property => property.key === 'objects')?.valueNode;
    if (objects?.type !== 'object') continue;

    for (const { valueNode: object } of objectProperties(objects)) {
      if (object.type !== 'object') continue;
      const typeProperty = objectProperties(object).find(property => property.key === 'type');
      const typeValue = typeProperty && getNodeValue(typeProperty.valueNode);
      const definition =
        typeof typeValue === 'string'
          ? formIndex.typeToDefinition.get(typeValue) ?? (formIndex.index.has(typeValue) ? typeValue : undefined)
          : undefined;

      if (typeProperty && !definition) {
        issues.push({
          message: `Unknown 4D object type "${typeValue}".`,
          offset: typeProperty.valueNode.offset + 1,
          length: Math.max(String(typeValue).length, 1),
          severity: 'error'
        });
        continue;
      }
      if (definition) validateObject(object, formIndex.index.get(definition) ?? new Map(), issues, resolveRef);
    }
    if (styleSheets) {
      validateClasses(objects, text, styleSheets.classes, issues);
      issues.push(...cascadeIssues(objects, styleSheets.sheets));
    }
  }
  return issues;
}

/** Reports the paths of the form "css" attribute (string, `{ path }` or array of them) not found on disk. */
function validateStyleSheetPaths(node: Node, missing: Set<string>, issues: Issue[]): void {
  if (node.type === 'array') {
    for (const child of node.children ?? []) validateStyleSheetPaths(child, missing, issues);
    return;
  }
  const pathNode = node.type === 'object' ? objectProperties(node).find(property => property.key === 'path')?.valueNode : node;
  const value = pathNode && getNodeValue(pathNode);
  if (typeof value !== 'string' || !missing.has(value)) return;
  issues.push({
    message: `Style sheet "${value}" not found.`,
    offset: pathNode!.offset,
    length: pathNode!.length,
    severity: 'error'
  });
}

/** Checks the "class" attributes of `node` and its descendants (listbox columns, headers, footers). */
function validateClasses(node: Node, text: string, classes: Set<string>, issues: Issue[]): void {
  if (node.type === 'array') {
    for (const child of node.children ?? []) validateClasses(child, text, classes, issues);
    return;
  }
  for (const { key, valueNode } of objectProperties(node)) {
    if (key !== 'class' || valueNode.type !== 'string') {
      validateClasses(valueNode, text, classes, issues);
      continue;
    }
    const raw = text.slice(valueNode.offset + 1, valueNode.offset + valueNode.length - 1);
    for (const match of raw.matchAll(/\S+/g)) {
      const name = match[0];
      if (classes.has(name)) continue;
      const suggestion = closestKey(name, [...classes]);
      issues.push({
        message: `CSS class "${name}" is not defined in the form style sheets.${suggestion ? ` Did you mean "${suggestion}"?` : ''}`,
        offset: valueNode.offset + 1 + (match.index ?? 0),
        length: name.length,
        severity: 'error'
      });
    }
  }
}

function validateObject(
  node: Node,
  allowed: Map<string, PropertyInfo>,
  issues: Issue[],
  resolveRef?: RefResolver,
  ignore: Set<string> = new Set()
): void {
  for (const { key, keyNode, valueNode } of objectProperties(node)) {
    if (ignore.has(key)) continue;
    const info = allowed.get(key);
    if (!info) {
      const suggestion = closestKey(key, [...allowed.keys()]);
      issues.push({
        message: `Unknown 4D attribute "${key}".${suggestion ? ` Did you mean "${suggestion}"?` : ''}`,
        offset: keyNode.offset + 1,
        length: key.length,
        severity: 'error'
      });
      continue;
    }
    if (valueNode.type === 'object') {
      validateRef(valueNode, info, issues, resolveRef);
      continue;
    }
    if (valueNode.type === 'array') continue;
    const message = checkFormValue(info, getNodeValue(valueNode));
    if (message) issues.push({ message, offset: valueNode.offset, length: valueNode.length, severity: 'warning' });
  }
}

/**
 * `{ "$ref": "/SOURCES/tips.json#/Tip" }` stands for the value the pointer resolves to,
 * so the attribute is checked against that value instead of the object literal.
 */
function validateRef(node: Node, info: PropertyInfo, issues: Issue[], resolveRef?: RefResolver): void {
  const ref = objectProperties(node).find(property => property.key === '$ref');
  if (!ref) return;

  const target = getNodeValue(ref.valueNode);
  if (typeof target !== 'string') {
    issues.push({
      message: 'A "$ref" value must be a string such as "/SOURCES/tips.json#/Tip".',
      offset: ref.valueNode.offset,
      length: ref.valueNode.length,
      severity: 'error'
    });
    return;
  }
  if (!resolveRef) return;

  const { value, error } = resolveRef(target);
  const message = error ?? checkFormValue(info, value);
  if (message) {
    issues.push({
      message: `"${info.name}" reference "${target}": ${message}`,
      offset: ref.valueNode.offset,
      length: ref.valueNode.length,
      severity: 'warning'
    });
  }
}

export function checkFormValue(info: PropertyInfo, value: unknown): string | undefined {
  if (info.refs.includes('picture')) return typeof value === 'string' ? undefined : 'Expected a picture path.';
  if (info.refs.includes('color')) {
    return typeof value === 'string' ? checkColor(value) : 'Expected a color.';
  }
  if (info.pattern && typeof value === 'string' && !new RegExp(info.pattern).test(value)) {
    return `"${value}" does not match the expected format (${info.pattern}).`;
  }
  if (info.enums.length && !info.freeForm && !info.enums.includes(String(value))) {
    return `Invalid value "${String(value)}". Expected one of: ${info.enums.join(', ')}.`;
  }
  if (info.enums.length) return undefined;

  const numericOnly = info.types.length > 0 && info.types.every(type => NUMERIC_TYPES.has(type));
  if (numericOnly) {
    if (typeof value !== 'number') return `Expected a number, got "${String(value)}".`;
    if (info.minimum !== undefined && value < info.minimum) {
      return `${value} is lower than the minimum (${info.minimum}).`;
    }
    return undefined;
  }
  if (info.types.length === 1 && info.types[0] === 'boolean' && typeof value !== 'boolean') {
    return `Expected true or false, got "${String(value)}".`;
  }
  if (info.types.length === 1 && info.types[0] === 'string' && typeof value !== 'string') {
    return `Expected a string, got "${String(value)}".`;
  }
  return undefined;
}

export interface FormCompletion {
  /** Missing property names for the object at the cursor. */
  keys?: [string, PropertyInfo][];
  /** Enum values for the property currently being typed. */
  values?: { property: string; info: PropertyInfo };
}

export function formCompletions(text: string, offset: number, formIndex: FormIndex): FormCompletion {
  const root = parseTree(text);
  if (!root) return {};

  const location = getLocation(text, offset);
  const containingPath = location.isAtPropertyKey ? location.path : location.path.slice(0, -1);
  const allowed = resolveAllowed(root, containingPath, formIndex);
  if (!allowed) return {};

  if (location.isAtPropertyKey) {
    const containingNode = containingPath.length ? findNodeAtLocation(root, containingPath) : root;
    const existing = new Set(objectProperties(containingNode ?? root).map(property => property.key));
    return { keys: [...allowed].filter(([name]) => !existing.has(name)) };
  }

  const propertyName = location.path[location.path.length - 1];
  const info = typeof propertyName === 'string' ? allowed.get(propertyName) : undefined;
  return info?.enums.length ? { values: { property: propertyName as string, info } } : {};
}

function resolveAllowed(root: Node, path: Segment[], formIndex: FormIndex): Map<string, PropertyInfo> | undefined {
  if (path.length === 0) return formIndex.index.get('form');
  const typeNode = findNodeAtLocation(root, [...path, 'type']);
  if (!typeNode) return undefined;
  const typeValue = getNodeValue(typeNode);
  if (typeof typeValue !== 'string') return undefined;
  const definition = formIndex.typeToDefinition.get(typeValue) ?? (formIndex.index.has(typeValue) ? typeValue : undefined);
  return definition ? formIndex.index.get(definition) : undefined;
}

function objectProperties(node: Node): { key: string; keyNode: Node; valueNode: Node }[] {
  if (node.type !== 'object' || !node.children) return [];
  return node.children
    .map(property => ({
      key: String(property.children?.[0]?.value ?? ''),
      keyNode: property.children?.[0] as Node,
      valueNode: property.children?.[1] as Node
    }))
    .filter(property => property.keyNode && property.valueNode);
}

function closestKey(input: string, candidates: string[]): string | undefined {
  let best: string | undefined;
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    const distance = levenshtein(input, candidate);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return bestDistance <= Math.max(2, Math.floor(input.length / 2)) ? best : undefined;
}

function levenshtein(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  for (let i = 0; i < rows; i++) dp[i][0] = i;
  for (let j = 0; j < cols; j++) dp[0][j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[rows - 1][cols - 1];
}
