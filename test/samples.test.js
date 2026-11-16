// Regression test: validates every file of `samples` with the compiled code (`out/`) and compares
// the diagnostics with `samples.snapshot.txt`.
//   npm test                    compile, then compare
//   npm test -- --update        compile, then rewrite the snapshot after an intended change
// The extension glue (`extension.ts`: quick fixes, watchers) is not covered: it needs VS Code.

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const out = path.join(root, 'out');
const snapshotFile = path.join(__dirname, 'samples.snapshot.txt');

const { validateStylesheet } = require(path.join(out, 'validator'));
const { parseStylesheet } = require(path.join(out, 'parser'));
const { buildIndex, buildFormIndex } = require(path.join(out, 'schema'));
const { validateForm } = require(path.join(out, 'formValidator'));
const { formClasses } = require(path.join(out, 'cssClasses'));
const { createRefResolver, formFileCandidates } = require(path.join(out, 'jsonRef'));

const schema = JSON.parse(fs.readFileSync(path.join(root, 'schema', 'formsSchema.json'), 'utf8'));
const index = buildIndex(schema);
const formIndex = buildFormIndex(schema);

function read(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
}

function walk(folder) {
  return fs
    .readdirSync(folder, { withFileTypes: true })
    .flatMap(entry => (entry.isDirectory() ? walk(path.join(folder, entry.name)) : [path.join(folder, entry.name)]));
}

/** 1-based "line:column" of `offset`, easier to read in the snapshot than a raw offset. */
function position(text, offset) {
  const before = text.slice(0, offset);
  return `${before.split('\n').length}:${offset - before.lastIndexOf('\n')}`;
}

function diagnostics() {
  const lines = [];
  const files = walk(path.join(root, 'samples')).sort();
  for (const file of files) {
    const relative = path.relative(root, file).split(path.sep).join('/');
    const text = read(file);
    let issues = [];
    if (/\.(4dcss|css)$/i.test(file)) {
      issues = validateStylesheet(parseStylesheet(text), index);
    } else if (/\.4dform$/i.test(file)) {
      const form = JSON.parse(text);
      issues = validateForm(
        text,
        formIndex,
        createRefResolver(file, form),
        formClasses(file, form, read),
        picture => formFileCandidates(file, picture).some(fs.existsSync)
      );
    } else {
      continue;
    }
    for (const issue of issues) {
      const code = issue.code ? ` [${issue.code}]` : '';
      lines.push(`${relative}:${position(text, issue.offset)} ${issue.severity}${code} ${issue.message}`);
    }
  }
  return lines;
}

const actual = diagnostics();

if (process.argv.includes('--update')) {
  fs.writeFileSync(snapshotFile, actual.join('\n') + '\n');
  console.log(`Snapshot updated: ${actual.length} diagnostics.`);
  process.exit(0);
}

const expected = (read(snapshotFile) ?? '').split('\n').filter(Boolean);
const missing = expected.filter(line => !actual.includes(line));
const unexpected = actual.filter(line => !expected.includes(line));

if (!missing.length && !unexpected.length) {
  console.log(`OK: ${actual.length} diagnostics match the snapshot.`);
  process.exit(0);
}
for (const line of missing) console.log(`- ${line}`);
for (const line of unexpected) console.log(`+ ${line}`);
console.log(
  `\nFAILED: ${missing.length} diagnostic(s) gone (-), ${unexpected.length} new (+).` +
    '\nIf the change is intended, run "npm test -- --update" and commit the snapshot.'
);
process.exit(1);
