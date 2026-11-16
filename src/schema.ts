/**
 * Reads the 4D Forms JSON Schema and turns it into a flat index:
 * object type -> attribute name -> attribute description.
 */

export interface SchemaNode {
  properties?: Record<string, SchemaNode>;
  items?: SchemaNode | SchemaNode[];
  additionalProperties?: SchemaNode;
  allOf?: SchemaNode[];
  oneOf?: SchemaNode[];
  anyOf?: SchemaNode[];
  $ref?: string;
  enum?: unknown[];
  type?: string | string[];
  pattern?: string;
  minimum?: number;
  $comment?: string;
  description?: string;
}

export interface PropertyInfo {
  name: string;
  /** Allowed literal values, when the schema declares an enum. */
  enums: string[];
  /** JSON types (string, integer, number, boolean, object, array). */
  types: string[];
  /** Names of `#/definitions/types/*` referenced by the property (color, picture, ...). */
  refs: string[];
  /** True when at least one schema branch accepts an arbitrary value, so enums are only hints. */
  freeForm: boolean;
  pattern?: string;
  minimum?: number;
  comment?: string;
}

export type ObjectIndex = Map<string, Map<string, PropertyInfo>>;

/** Attributes that can never be set from a style sheet. */
export const FORBIDDEN_ATTRIBUTES = new Set([
  'method',
  'type',
  'class',
  'event',
  'events',
  'choiceList',
  'excludedList',
  'labels',
  'list',
  'requiredList'
]);

/**
 * Coordinates the 4D form editor writes in the form JSON for every object (and `width` for every
 * listbox column), even after they are removed by hand. A style sheet value for them only applies
 * when declared `!important`.
 */
export const EDITOR_GEOMETRY = new Set(['left', 'top', 'width', 'height']);

/** CSS attribute names accepted by 4D as aliases of 4D attribute names. */
export const CSS_ALIASES = new Map<string, string>([
  ['border-style', 'borderStyle'],
  ['background-color', 'fill'],
  ['font-family', 'fontFamily'],
  ['font-size', 'fontSize'],
  ['font-style', 'fontStyle'],
  ['font-weight', 'fontWeight'],
  ['color', 'stroke'],
  ['text-align', 'textAlign'],
  ['text-decoration', 'textDecoration'],
  ['vertical-align', 'verticalAlign']
]);

/**
 * Values kept when the CSS name is used: 4D specific values (`sunken`, `automatic`, ...)
 * are rejected by 4D with CSS attribute names.
 */
export const CSS_ALIAS_VALUES = new Map<string, string[]>([
  ['border-style', ['none', 'solid', 'dotted', 'double']],
  ['text-align', ['left', 'right', 'center', 'justify']],
  ['vertical-align', ['top', 'middle', 'bottom']],
  ['font-style', ['normal', 'italic']],
  ['font-weight', ['normal', 'bold']],
  ['text-decoration', ['none', 'underline']]
]);

/** Media features supported by 4D style sheets. */
export const MEDIA_FEATURES = new Map<string, string[]>([
  ['prefers-color-scheme', ['light', 'dark']],
  ['form-theme', ['fluent-ui', 'win-classic', 'liquid-glass', 'mac-classic']]
]);

/** Listbox inner objects, usable as object type selectors. */
const LISTBOX_SUBTYPES = ['column', 'header', 'footer'];

export function buildIndex(schema: unknown): ObjectIndex {
  const root = schema as { definitions?: Record<string, SchemaNode> };
  const definitions = root.definitions ?? {};
  const result: ObjectIndex = new Map();

  for (const [name, node] of Object.entries(definitions)) {
    if (name === 'types') continue;
    result.set(name, sanitize(collectProperties(node, definitions, new Set())));
  }

  const listbox = definitions['listbox'];
  const columns = listbox && findProperty(listbox, definitions, 'columns');
  const column = columns && (Array.isArray(columns.items) ? columns.items[0] : columns.items);
  if (column) {
    const columnProperties = sanitize(collectProperties(column, definitions, new Set()));
    columnProperties.delete('header');
    columnProperties.delete('footer');
    result.set('column', columnProperties);

    for (const part of ['header', 'footer']) {
      const node = findProperty(column, definitions, part);
      if (node) result.set(part, sanitize(collectProperties(node, definitions, new Set())));
    }
  }
  for (const subtype of LISTBOX_SUBTYPES) if (!result.has(subtype)) result.set(subtype, new Map());

  return result;
}

function sanitize(properties: Map<string, PropertyInfo>): Map<string, PropertyInfo> {
  for (const name of FORBIDDEN_ATTRIBUTES) properties.delete(name);
  return properties;
}

export interface FormIndex {
  /** Object type name (matches the JSON "type" attribute value) -> attribute name -> info. */
  index: ObjectIndex;
  /** "type" attribute value -> definition name, in case they ever differ. */
  typeToDefinition: Map<string, string>;
}

/**
 * Same as `buildIndex`, but keeps every attribute (including `type`, `method`, `events`, ...)
 * since a `.4DForm` file can set them, unlike a style sheet.
 */
export function buildFormIndex(schema: unknown): FormIndex {
  const root = schema as { definitions?: Record<string, SchemaNode> } & SchemaNode;
  const definitions = root.definitions ?? {};
  const index: ObjectIndex = new Map();
  const typeToDefinition = new Map<string, string>();
  const keep = new Set<string>();

  for (const [name, node] of Object.entries(definitions)) {
    if (name === 'types') continue;
    const properties = collectProperties(node, definitions, new Set(), keep);
    index.set(name, properties);
    const type = properties.get('type');
    if (type) for (const value of type.enums) typeToDefinition.set(value, name);
  }

  const listbox = definitions['listbox'];
  const columns = listbox && findProperty(listbox, definitions, 'columns');
  const column = columns && (Array.isArray(columns.items) ? columns.items[0] : columns.items);
  if (column) {
    const columnProperties = collectProperties(column, definitions, new Set(), keep);
    columnProperties.delete('header');
    columnProperties.delete('footer');
    index.set('column', columnProperties);

    for (const part of ['header', 'footer']) {
      const node = findProperty(column, definitions, part);
      if (node) index.set(part, collectProperties(node, definitions, new Set(), keep));
    }
  }
  for (const subtype of LISTBOX_SUBTYPES) if (!index.has(subtype)) index.set(subtype, new Map());

  index.set('form', collectProperties(root, definitions, new Set(), keep));

  return { index, typeToDefinition };
}

/** Looks up a property declaration through `$ref`, `allOf`, `oneOf` and `anyOf`. */
export function findProperty(
  node: SchemaNode,
  definitions: Record<string, SchemaNode>,
  name: string,
  seen = new Set<string>()
): SchemaNode | undefined {
  if (node.properties?.[name]) return node.properties[name];

  const referenced = resolveRef(node, definitions, seen);
  if (referenced) {
    const found = findProperty(referenced.node, definitions, name, referenced.seen);
    if (found) return found;
  }
  for (const child of [...(node.allOf ?? []), ...(node.oneOf ?? []), ...(node.anyOf ?? [])]) {
    const found = findProperty(child, definitions, name, seen);
    if (found) return found;
  }
  return undefined;
}

function resolveRef(
  node: SchemaNode,
  definitions: Record<string, SchemaNode>,
  seen: Set<string>
): { node: SchemaNode; seen: Set<string>; key: string } | undefined {
  if (!node.$ref) return undefined;
  const key = node.$ref.replace(/^#\/definitions\//, '');
  if (seen.has(key)) return undefined;
  const target = key.split('/').reduce<SchemaNode | undefined>(
    (current, segment) => (current ? (current as unknown as Record<string, SchemaNode>)[segment] : undefined),
    definitions as unknown as SchemaNode
  );
  if (!target) return undefined;
  const next = new Set(seen);
  next.add(key);
  return { node: target, seen: next, key };
}

function collectProperties(
  node: SchemaNode,
  definitions: Record<string, SchemaNode>,
  seen: Set<string>,
  exclude: Set<string> = FORBIDDEN_ATTRIBUTES
): Map<string, PropertyInfo> {
  const result = new Map<string, PropertyInfo>();
  const merge = (source: Map<string, PropertyInfo>) => {
    for (const [name, info] of source) {
      const existing = result.get(name);
      if (!existing) {
        result.set(name, { ...info, enums: [...info.enums], types: [...info.types], refs: [...info.refs] });
        continue;
      }
      existing.enums = unique([...existing.enums, ...info.enums]);
      existing.types = unique([...existing.types, ...info.types]);
      existing.refs = unique([...existing.refs, ...info.refs]);
      existing.freeForm ||= info.freeForm;
      existing.comment ??= info.comment;
      existing.pattern ??= info.pattern;
    }
  };

  const referenced = resolveRef(node, definitions, seen);
  if (referenced) merge(collectProperties(referenced.node, definitions, referenced.seen, exclude));

  if (node.properties) {
    for (const [name, property] of Object.entries(node.properties)) {
      if (exclude.has(name)) continue;
      const facets = collectFacets(property, definitions, new Set());
      result.set(name, {
        name,
        enums: facets.enums,
        types: facets.types,
        refs: facets.refs,
        freeForm: facets.freeForm,
        pattern: facets.pattern,
        minimum: facets.minimum,
        comment: property.$comment ?? property.description ?? facets.comment
      });
    }
  }
  for (const child of [...(node.allOf ?? []), ...(node.oneOf ?? []), ...(node.anyOf ?? [])]) {
    merge(collectProperties(child, definitions, seen, exclude));
  }
  return result;
}

interface Facets {
  enums: string[];
  types: string[];
  refs: string[];
  freeForm: boolean;
  pattern?: string;
  minimum?: number;
  comment?: string;
}

function collectFacets(node: SchemaNode, definitions: Record<string, SchemaNode>, seen: Set<string>): Facets {
  const facets: Facets = { enums: [], types: [], refs: [], freeForm: false };
  const absorb = (other: Facets) => {
    facets.enums.push(...other.enums);
    facets.types.push(...other.types);
    facets.refs.push(...other.refs);
    facets.freeForm ||= other.freeForm;
    facets.pattern ??= other.pattern;
    facets.minimum ??= other.minimum;
    facets.comment ??= other.comment;
  };

  if (node.enum) facets.enums.push(...node.enum.map(String));
  else if (node.type && !node.pattern) facets.freeForm = true;
  if (Array.isArray(node.type)) facets.types.push(...node.type);
  else if (node.type) facets.types.push(node.type);
  if (node.pattern) facets.pattern = node.pattern;
  if (typeof node.minimum === 'number') facets.minimum = node.minimum;
  if (node.$comment ?? node.description) facets.comment = node.$comment ?? node.description;

  const referenced = resolveRef(node, definitions, seen);
  if (referenced) {
    facets.refs.push(referenced.key.replace(/^types\//, ''));
    absorb(collectFacets(referenced.node, definitions, referenced.seen));
  }
  for (const child of [...(node.oneOf ?? []), ...(node.anyOf ?? []), ...(node.allOf ?? [])]) {
    absorb(collectFacets(child, definitions, seen));
  }

  facets.enums = unique(facets.enums);
  facets.types = unique(facets.types);
  facets.refs = unique(facets.refs);
  return facets;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
