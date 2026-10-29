# Contributing

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

Then press `F5` to launch an Extension Development Host on the `samples` folder, a minimal 4D project:

- `test.4dcss`: style sheet diagnostics
- `Project/Sources/Forms/Test`: unknown attributes and `$ref` resolution (`/SOURCES/tips.json`)
- `Project/Sources/Forms/Buttons`: classes from `Project/Sources/styleSheets.css`, no errors expected
- `Project/Sources/Forms/CssClasses`: CSS classes and `css` style sheet paths (from `/RESOURCES/css/`,
  from the form folder), with a typo, an unknown class and a missing style sheet on purpose

## Packaging

```bash
npm run package
```

This produces a `.vsix` file that can be installed locally or uploaded to the Marketplace.
