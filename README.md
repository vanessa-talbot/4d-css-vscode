# 4D Form & CSS Language Support for VS Code

Editing support for 4D form style sheets and `.4DForm` files, driven by the 4D Forms JSON Schema and
the [4D style sheets documentation](https://developer.4d.com/docs/FormEditor/stylesheets).

## Features

- `4d-css` language mode for `.4dcss` files and for `styleSheets.css`, `styleSheets_mac.css`, `styleSheets_windows.css`
- syntax highlighting (selectors, attributes, `url()`, `rgb()`, `!important`, media features)
- attribute and value completion scoped to the object type(s) of the current selector
- hover documentation built from the schema `$comment` / `description`
- **4D CSS: Reference** view with schema-driven object properties, selector reference and `@media`
  reference. The object property list follows the current selector automatically and can insert
  properties at the cursor; `@media` entries can insert a media block.
- diagnostics
- `.4DForm` files are validated against the same JSON Schema: VS Code's built-in JSON support gives
  base schema validation, and `src/formValidator.ts` adds 4D-specific checks (unknown attributes with
  "did you mean" suggestions, unknown object types, enum/color/number value checks) plus property
  and enum-value completion (also triggered by <kbd>Space</kbd>, like the CSS side)

### Supported selectors

| Selector | Example |
| --- | --- |
| object type | `button { ... }`, `text, input { ... }` |
| object name | `#okButton { ... }` |
| class | `.okButtons { ... }`, `text.center { ... }` |
| all objects | `* { ... }` |
| attribute | `[borderStyle]`, `[text=Hello]`, `[text~=Hello]`, `[text\|=Hello]` |

Listbox inner objects `column`, `header` and `footer` are handled as object types.

### Supported declarations

- 4D JSON attribute names (from the schema)
- CSS aliases: `border-style`, `background-color`, `font-family`, `font-size`, `font-style`,
  `font-weight`, `color`, `text-align`, `text-decoration`, `vertical-align`
- `!important`
- `url()` for `icon`, `picture`, `customBackgroundPicture`
- colors as CSS name, `#RRGGBB` or `rgb()`
- `@media (prefers-color-scheme: light|dark)` and
  `@media (form-theme: fluent-ui|win-classic|liquid-glass|mac-classic)`, including nesting

### Diagnostics

- attributes that can never be set from a style sheet: `method`, `type`, `class`, `event`,
  `choiceList`, `excludedList`, `labels`, `list`, `requiredList`
- unknown attributes, or attributes not supported by the selected object type
- invalid enum values, numbers, booleans, colors and formats (`dateFormat`, `timeFormat`, heights)
- 4D specific values used with a CSS attribute name (e.g. `border-style: sunken`)
- unknown object types, invalid attribute selectors and unsupported operators
- unknown media features/values and unsupported at-rules

## Source layout

| File | Role |
| --- | --- |
| `src/schema.ts` | reads the JSON Schema, resolves `$ref`/`allOf`/`oneOf`/`anyOf`, builds the type → attribute index |
| `src/parser.ts` | CSS parser (rules, declarations, nested `@media`) keeping absolute offsets |
| `src/validator.ts` | selector, attribute and value checks (no VS Code dependency) |
| `src/formValidator.ts` | `.4DForm` (JSON) attribute and value checks, and completion helpers (no VS Code dependency) |
| `src/docsView.ts` | interactive 4D CSS reference view built from the schema and supported media features |
| `src/extension.ts` | VS Code glue: diagnostics, completion, hover |

## Build

Requires Node.js.

```bash
npm install
npm run compile
```

Then press `F5` to launch an Extension Development Host and open `samples/test.4dcss`.

## Schema

`schema/formsSchema.json` is the source of truth. Use the `4dCss.schemaPath` setting to point to
another schema (absolute path, or relative to the first workspace folder), then run
**4D CSS: Reload Schema**.

## Commands

- **4D CSS: Show Reference** — opens the interactive reference view for object properties, selectors
  and `@media` features.
- **4D CSS: Reload Schema** — reloads the JSON Schema and revalidates the open documents.
- **4D CSS: Validate All Form and Style Sheet Files** — validates every `.4DForm`, `.4dcss` and
  `styleSheets*.css` file of the workspace, including files that are not open.
