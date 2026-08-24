/**
 * Resolution of the `{ "$ref": "/SOURCES/tips.json#/Tip" }` values a `.4DForm` file can use
 * instead of a literal value: a 4D file path followed by an RFC 6901 JSON pointer.
 */

import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'jsonc-parser';

export interface RefResolution {
  value?: unknown;
  error?: string;
}

/** Resolves a `$ref` string to the value it points at. */
export type RefResolver = (ref: string) => RefResolution;

/** 4D path prefixes, relative to the folder containing the project package. */
const PROJECT_FOLDERS: [string, string[]][] = [
  ['/SOURCES/', ['Project', 'Sources']],
  ['/PROJECT/', ['Project']],
  ['/RESOURCES/', ['Resources']]
];

export function splitRef(ref: string): { file: string; pointer: string } {
  const hash = ref.indexOf('#');
  return hash < 0 ? { file: ref, pointer: '' } : { file: ref.slice(0, hash), pointer: ref.slice(hash + 1) };
}

/** Walks `pointer` (`/a/0/b`) inside an already parsed JSON value. */
export function resolvePointer(root: unknown, pointer: string): RefResolution {
  if (pointer === '') return { value: root };
  if (!pointer.startsWith('/')) return { error: `Invalid JSON pointer "${pointer}": it must start with "/".` };

  let current = root;
  for (const segment of pointer.slice(1).split('/')) {
    const token = segment.replace(/~1/g, '/').replace(/~0/g, '~');
    if (Array.isArray(current)) {
      const position = Number(token);
      if (!Number.isInteger(position) || position < 0 || position >= current.length) {
        return { error: `JSON pointer "${pointer}" does not resolve: no index "${token}".` };
      }
      current = current[position];
    } else if (current && typeof current === 'object' && token in (current as object)) {
      current = (current as Record<string, unknown>)[token];
    } else {
      return { error: `JSON pointer "${pointer}" does not resolve: no member "${token}".` };
    }
  }
  return { value: current };
}

/** Folder holding the project package (`<root>/Project/Sources/...`), starting from the form file. */
function projectRoot(formPath: string): string | undefined {
  let directory = path.dirname(formPath);
  for (;;) {
    if (fs.existsSync(path.join(directory, 'Project', 'Sources'))) return directory;
    const parent = path.dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

/** Absolute paths a 4D file path may point at, most specific first. */
export function refFileCandidates(formPath: string, file: string): string[] {
  if (path.isAbsolute(file) && !file.startsWith('/')) return [file];

  const relative = file.replace(/^\//, '').split('/');
  const candidates: string[] = [];
  const root = projectRoot(formPath);
  if (root) {
    for (const [prefix, folders] of PROJECT_FOLDERS) {
      if (file.toUpperCase().startsWith(prefix)) {
        candidates.push(path.join(root, ...folders, ...relative.slice(1)));
      }
    }
    candidates.push(path.join(root, ...relative));
  }
  // Fallbacks for files kept next to the form (samples, standalone files).
  const formDirectory = path.dirname(formPath);
  candidates.push(path.join(formDirectory, ...relative), path.join(formDirectory, relative[relative.length - 1]));
  return [...new Set(candidates)];
}

/**
 * Builds a resolver for `formPath`. `localRoot` is the parsed form itself, used by
 * pointer-only references (`#/pages/0/...`). Parsed files are cached for the caller's lifetime.
 */
export function createRefResolver(formPath: string, localRoot?: unknown): RefResolver {
  const cache = new Map<string, unknown>();

  return (ref: string): RefResolution => {
    const { file, pointer } = splitRef(ref);
    if (!file) return resolvePointer(localRoot, pointer);

    if (!cache.has(file)) {
      const found = refFileCandidates(formPath, file).find(candidate => fs.existsSync(candidate));
      if (!found) return { error: `File "${file}" not found.` };
      try {
        cache.set(file, parse(fs.readFileSync(found, 'utf8')));
      } catch {
        return { error: `File "${file}" is not valid JSON.` };
      }
    }
    return resolvePointer(cache.get(file), pointer);
  };
}
