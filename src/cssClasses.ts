/**
 * Collects the CSS class names a `.4DForm` can use: the ones declared in the project style sheets
 * (`/SOURCES/styleSheets*.css`) and in the style sheets listed by the form "css" attribute.
 */

import * as fs from 'fs';
import * as path from 'path';
import { parseStylesheet } from './parser';
import { projectRoot, refFileCandidates } from './jsonRef';

/** Style sheets loaded for every form of the project; the platform ones are both kept. */
const PROJECT_STYLE_SHEETS = ['styleSheets.css', 'styleSheets_mac.css', 'styleSheets_windows.css'];

export interface FormClasses {
  classes: Set<string>;
  /** Style sheets the classes were read from. */
  files: string[];
  /** Paths of the form "css" attribute that do not lead to any file. */
  missing: Set<string>;
}

/**
 * Classes available to `formPath`, or `undefined` when no style sheet can be located
 * (standalone form outside a 4D project), in which case nothing should be reported.
 * `readFile` lets the caller serve unsaved editor contents.
 */
export function formClasses(
  formPath: string,
  form: unknown,
  readFile: (file: string) => string | undefined
): FormClasses | undefined {
  const root = projectRoot(formPath);
  const files: string[] = [];
  const missing = new Set<string>();
  if (root) {
    for (const name of PROJECT_STYLE_SHEETS) files.push(path.join(root, 'Project', 'Sources', name));
  }
  for (const sheet of formStyleSheets(form)) {
    const found = styleSheetCandidates(formPath, sheet).find(candidate => fs.existsSync(candidate));
    if (found) files.push(found);
    else missing.add(sheet);
  }

  const classes = new Set<string>();
  const read: string[] = [];
  for (const file of new Set(files)) {
    const text = readFile(file);
    if (text === undefined) continue;
    read.push(file);
    for (const name of styleSheetClasses(text)) classes.add(name);
  }
  if (!root && !read.length && !missing.size) return undefined;
  return { classes, files: read, missing };
}

/** Class names used in the selectors of a style sheet (`.name`). */
export function styleSheetClasses(text: string): Set<string> {
  const classes = new Set<string>();
  for (const rule of parseStylesheet(text).rules) {
    // Attribute selectors and strings may contain dots that are not class selectors.
    const selector = rule.selector.replace(/\[[^\]]*\]/g, ' ').replace(/"[^"]*"|'[^']*'/g, ' ');
    for (const match of selector.matchAll(/\.(-?[A-Za-z_][\w-]*)/g)) classes.add(match[1]);
  }
  return classes;
}

/** Paths listed by the form "css" attribute: a string, `{ path, media }`, or an array of them. */
function formStyleSheets(form: unknown): string[] {
  const css = form && typeof form === 'object' ? (form as Record<string, unknown>).css : undefined;
  return (Array.isArray(css) ? css : [css])
    .map(item => (item && typeof item === 'object' ? (item as Record<string, unknown>).path : item))
    .filter((item): item is string => typeof item === 'string' && item.length > 0);
}

/** A relative "css" path is resolved from the form folder, a "/RESOURCES/..." one from the project. */
function styleSheetCandidates(formPath: string, file: string): string[] {
  if (file.startsWith('/')) return refFileCandidates(formPath, file);
  return [path.resolve(path.dirname(formPath), file), ...refFileCandidates(formPath, file)];
}
