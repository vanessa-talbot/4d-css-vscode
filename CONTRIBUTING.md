# Contributing

## Source layout

| File | Role |
| --- | --- |
| `src/schema.ts` | reads the JSON Schema, resolves `$ref`/`allOf`/`oneOf`/`anyOf`, builds the type → attribute index |
| `src/parser.ts` | CSS parser (rules, declarations, nested `@media`) keeping absolute offsets |
| `src/validator.ts` | selector, attribute and value checks (no VS Code dependency) |
| `src/formValidator.ts` | `.4DForm` (JSON) attribute and value checks, and completion helpers (no VS Code dependency) |
| `src/cssClasses.ts` | locates and reads the style sheets a `.4DForm` loads, and the classes they declare |
| `src/cascade.ts` | style cascade checks: form attributes hiding style sheet values (no VS Code dependency) |
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
- `Project/Sources/Forms/Cascade`: form attributes overriding `form.css` rules, a listbox column and
  header blocking inheritance, `fontFamily` / `fontTheme` competing, strict duplicates of a style
  sheet value, and cases that must not be reported (`!important`, inherited values) or that are not
  duplicates (different value in dark mode), plus `width` / `height` hidden by the coordinates the form
  editor always writes, and their `!important` counterpart that must not be reported
- `Project/Sources/Forms/Pictures`: `icon`, `customBackgroundPicture` and `picture` paths, each one
  found (from `/RESOURCES/Images/`, from the form folder) and missing on purpose, plus a `var:`
  picture variable that must not be reported

## Tests

```bash
npm test
```

Compiles, validates every file of `samples` and compares the diagnostics (file, line, column,
severity, code, message) with `test/samples.snapshot.txt`. Lines gone are shown with `-`, new ones
with `+`. When the difference is intended (new check, reworded message, new sample), update the
snapshot and commit it with the change:

```bash
npm test -- --update
```

Review the snapshot diff before committing: it is the list of what the change does to the samples.
Each new check should come with a sample that triggers it and, when relevant, one that must not.
`src/extension.ts` (quick fixes, watchers) needs VS Code and is not covered: check it with `F5`.

## Packaging

```bash
npm run package
```

This produces a `.vsix` file that can be installed locally or uploaded to the Marketplace.
