/**
 * Collects the CSS class names a `.4DForm` can use: the ones declared in the project style sheets
 * (`/SOURCES/styleSheets*.css`) and in the style sheets listed by the form "css" attribute.
 */

import * as fs from 'fs';
import * as path from 'path';
import { parseStylesheet } from './parser';
import { projectRoot, refFileCandidates } from './jsonRef';

/** Style sheets loaded for every form of the project, with their platform; the platform ones are both kept. */
const PROJECT_STYLE_SHEETS: [string, string?][] = [
  ['styleSheets.css'],
  ['styleSheets_mac.css', 'mac'],
  ['styleSheets_windows.css', 'windows']
];

export interface StyleSheetSource {
  file: string;
  /** Path shown in messages: relative to the project folder when there is one. */
  label: string;
  text: string;
  /** Only loaded on this platform ("mac" or "windows"). */
  platform?: string;
}

export interface FormClasses {
  classes: Set<string>;
  /** Style sheets the classes were read from. */
  files: string[];
  /** Contents of those style sheets, in loading order (lowest priority first). */
  sheets: StyleSheetSource[];
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
  const files = new Map<string, string | undefined>();
  const missing = new Set<string>();
  if (root) {
    for (const [name, platform] of PROJECT_STYLE_SHEETS) files.set(path.join(root, 'Project', 'Sources', name), platform);
  }
  for (const sheet of formStyleSheets(form)) {
    const found = styleSheetCandidates(formPath, sheet.path).find(candidate => fs.existsSync(candidate));
    if (!found) missing.add(sheet.path);
    else if (!files.has(found)) files.set(found, sheet.media);
  }

  const classes = new Set<string>();
  const sheets: StyleSheetSource[] = [];
  for (const [file, platform] of files) {
    const text = readFile(file);
    if (text === undefined) continue;
    const label = root ? path.relative(root, file).split(path.sep).join('/') : path.basename(file);
    sheets.push({ file, label, text, platform });
    for (const name of styleSheetClasses(text)) classes.add(name);
  }
  if (!root && !sheets.length && !missing.size) return undefined;
  return { classes, files: sheets.map(sheet => sheet.file), missing, sheets };
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

/** Style sheets listed by the form "css" attribute: a path, `{ path, media }`, or an array of them. */
function formStyleSheets(form: unknown): { path: string; media?: string }[] {
  const css = form && typeof form === 'object' ? (form as Record<string, unknown>).css : undefined;
  return (Array.isArray(css) ? css : [css])
    .map((item): Record<string, unknown> => (item && typeof item === 'object' ? (item as Record<string, unknown>) : { path: item }))
    .filter(entry => typeof entry.path === 'string' && entry.path.length > 0)
    .map(entry => ({ path: entry.path as string, media: typeof entry.media === 'string' ? entry.media : undefined }));
}

/** A relative "css" path is resolved from the form folder, a "/RESOURCES/..." one from the project. */
function styleSheetCandidates(formPath: string, file: string): string[] {
  if (file.startsWith('/')) return refFileCandidates(formPath, file);
  return [path.resolve(path.dirname(formPath), file), ...refFileCandidates(formPath, file)];
}
