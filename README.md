# 4D Form & CSS Language Support for VS Code

Editing support for 4D form style sheets and `.4DForm` files, driven by the 4D Forms JSON Schema and
the [4D style sheets documentation](https://developer.4d.com/docs/FormEditor/stylesheets).

## Preview

![4D CSS syntax highlighting, diagnostics, and contextual reference panel](docs/preview.png)

## Getting started

1. Install the extension from the
   [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=vanessa-talbot.4d-css-language-support).
2. Open a 4D project folder: `.4DForm` files and `styleSheets*.css` / `.4dcss` files are recognized
   automatically.
3. Open the **4D CSS** view in the activity bar to browse the reference.

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

## Schema

`schema/formsSchema.json` is the source of truth. The bundled schema matches **4D 21 R5**.

Use the `4dCss.schemaPath` setting to point to another schema (absolute path, or relative to the
first workspace folder), then run **4D CSS: Reload Schema**.

## Commands

- **4D CSS: Show Reference** — opens the interactive reference view for object properties, selectors
  and `@media` features.
- **4D CSS: Reload Schema** — reloads the JSON Schema and revalidates the open documents.
- **4D CSS: Validate All Form and Style Sheet Files** — validates every `.4DForm`, `.4dcss` and
  `styleSheets*.css` file of the workspace, including files that are not open.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the source layout and build instructions.
