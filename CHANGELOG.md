# Changelog

## 0.3.0 — 2026-10-29

- `.4DForm` validation reports, at information level, the attributes written in the form that
  override a style sheet declaration targeting the object (form attributes win over every rule that
  is not `!important`, even with a default value such as `"automatic"`), and the attributes of a
  listbox column, header or footer that prevent it from inheriting the value its listbox gets from a
  style sheet. `fontFamily` and `fontTheme` compete as a single font attribute, and a `fontTheme`
  set next to a `fontFamily` in the form is reported as ignored. A quick fix removes the attribute
  from the form.
- Attributes that only repeat a style sheet value (strict duplicates: removing them changes nothing,
  on any platform or media) are reported separately, with a quick fix removing all of them in the
  form at once.

## 0.2.2 — 2026-10-29

- `.4DForm` validation reports CSS classes (`"class"` attribute of objects, listbox columns, headers
  and footers) that are not defined in `/SOURCES/styleSheets*.css` nor in the form `css` style sheets,
  with a "did you mean" suggestion for typos.
- `.4DForm` validation reports the paths of the form `css` attribute that do not lead to any file.
- The extension now activates when a 4D project is opened, so `.4DForm` diagnostics show up without
  running **Validate All** first.

## 0.2.1 — 2026-10-21

- Updated the Forms schema to 4D 21 R5.

## 0.2.0 — 2026-08-26

- **4D CSS: Reference** view in the activity bar: schema-driven object properties, selector reference
  and `@media` reference, following the current selector and able to insert properties at the cursor.

## 0.1.2 — 2026-08-24

- `.4DForm` validation accepts numeric enum values.

## 0.1.1 — 2026-08-24

- Fixed `$ref` resolution in the bundled schema.

## 0.1.0 — 2026-08-24

- First release: `4d-css` language mode, syntax highlighting, completion, hover and diagnostics for
  4D style sheets.
- `.4DForm` files validated against the 4D Forms JSON Schema, with property and value completion.
