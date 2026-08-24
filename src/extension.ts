import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import * as jsonc from 'jsonc-parser';

import { Rule, parseStylesheet, stripComments } from './parser';
import {
  CSS_ALIASES,
  FORBIDDEN_ATTRIBUTES,
  FormIndex,
  MEDIA_FEATURES,
  ObjectIndex,
  PropertyInfo,
  buildFormIndex,
  buildIndex
} from './schema';
import { allowedProperties, analyzeSelector, validateStylesheet } from './validator';
import { formCompletions, validateForm } from './formValidator';
import { createRefResolver } from './jsonRef';

const LANGUAGE = '4d-css';
const FORM_EXTENSION = /\.4dform$/i;
const CSS_FILE = /(\.4dcss|[\\/]styleSheets(_mac|_windows)?\.css)$/i;

/** Files picked up by the "Validate Workspace" command. */
const WORKSPACE_GLOBS = ['**/*.4DForm', '**/*.4dcss', '**/styleSheets*.css'];
const WORKSPACE_EXCLUDE = '**/{node_modules,.git,Logs,Data}/**';

let index: ObjectIndex = new Map();
let formIndex: FormIndex = { index: new Map(), typeToDefinition: new Map() };
let diagnostics: vscode.DiagnosticCollection;
let formDiagnostics: vscode.DiagnosticCollection;
/** Documents validated by the workspace scan: their diagnostics survive closing the document. */
const scanned = new Set<string>();

function isFormDocument(document: vscode.TextDocument): boolean {
  return FORM_EXTENSION.test(document.fileName);
}

function isCssDocument(document: vscode.TextDocument): boolean {
  return document.languageId === LANGUAGE || CSS_FILE.test(document.fileName);
}

export function activate(context: vscode.ExtensionContext) {
  diagnostics = vscode.languages.createDiagnosticCollection(LANGUAGE);
  formDiagnostics = vscode.languages.createDiagnosticCollection('4d-form');
  context.subscriptions.push(
    diagnostics,
    formDiagnostics,
    vscode.commands.registerCommand('4dCss.reloadSchema', reload),
    vscode.commands.registerCommand('4dCss.validateWorkspace', validateWorkspace)
  );

  function reload(): void {
    try {
      const schema = JSON.parse(fs.readFileSync(schemaPath(context), 'utf8'));
      index = buildIndex(schema);
      formIndex = buildFormIndex(schema);
      for (const document of vscode.workspace.textDocuments) {
        validate(document);
        validateFormDocument(document);
      }
    } catch (error) {
      vscode.window.showErrorMessage(`4D CSS: unable to load schema: ${String(error)}`);
    }
  }
  reload();

  const validateAny = (document: vscode.TextDocument) => {
    validate(document);
    validateFormDocument(document);
  };

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(event => validateAny(event.document)),
    vscode.workspace.onDidOpenTextDocument(validateAny),
    vscode.workspace.onDidCloseTextDocument(document => {
      if (scanned.has(document.uri.toString())) return;
      diagnostics.delete(document.uri);
      formDiagnostics.delete(document.uri);
    }),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('4dCss.schemaPath')) reload();
    }),
    vscode.languages.registerCompletionItemProvider(LANGUAGE, completionProvider, '.', '#', '[', ':', ' ', '('),
    vscode.languages.registerHoverProvider(LANGUAGE, hoverProvider),
    vscode.languages.registerCompletionItemProvider('json', formCompletionProvider, ' ', '"', ':')
  );
}

function validateFormDocument(document: vscode.TextDocument): void {
  if (!isFormDocument(document)) return;
  const text = document.getText();
  let issues: ReturnType<typeof validateForm> = [];
  try {
    const resolver = createRefResolver(document.uri.fsPath, jsonc.parse(text));
    issues = validateForm(text, formIndex, resolver);
  } catch {
    return;
  }
  formDiagnostics.set(
    document.uri,
    issues.map(item => {
      const range = new vscode.Range(
        document.positionAt(item.offset),
        document.positionAt(item.offset + item.length)
      );
      const diagnostic = new vscode.Diagnostic(
        range,
        item.message,
        item.severity === 'error' ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning
      );
      diagnostic.source = '4D Form';
      return diagnostic;
    })
  );
}

const formCompletionProvider: vscode.CompletionItemProvider = {
  provideCompletionItems(document, position) {
    if (!isFormDocument(document)) return undefined;
    const offset = document.offsetAt(position);
    let result: ReturnType<typeof formCompletions>;
    try {
      result = formCompletions(document.getText(), offset, formIndex);
    } catch {
      return undefined;
    }

    if (result.keys) {
      return result.keys.map(([name, info]) => {
        const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Property);
        item.detail = '4D form attribute';
        item.documentation = documentation(info);
        item.insertText = new vscode.SnippetString(`"${name}": $0`);
        return item;
      });
    }
    if (result.values) {
      return result.values.info.enums.map(value => {
        const item = new vscode.CompletionItem(`"${value}"`, vscode.CompletionItemKind.Value);
        item.insertText = `"${value}"`;
        item.detail = `Value for ${result.values!.property}`;
        return item;
      });
    }
    return undefined;
  }
};

export function deactivate() {
  diagnostics?.dispose();
  formDiagnostics?.dispose();
}

/** Validates every `.4DForm` and 4D style sheet of the workspace, including closed files. */
async function validateWorkspace(): Promise<void> {
  if (!vscode.workspace.workspaceFolders?.length) {
    vscode.window.showWarningMessage('4D CSS: no folder is open.');
    return;
  }

  const found = new Map<string, vscode.Uri>();
  for (const glob of WORKSPACE_GLOBS) {
    for (const uri of await vscode.workspace.findFiles(glob, WORKSPACE_EXCLUDE)) {
      found.set(uri.toString(), uri);
    }
  }
  if (!found.size) {
    vscode.window.showInformationMessage('4D CSS: no .4DForm or 4D style sheet found in the workspace.');
    return;
  }

  scanned.clear();
  diagnostics.clear();
  formDiagnostics.clear();

  const problems = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: '4D CSS: validating workspace…' },
    async progress => {
      let count = 0;
      let done = 0;
      for (const uri of found.values()) {
        progress.report({ message: `${++done}/${found.size}`, increment: 100 / found.size });
        let document: vscode.TextDocument;
        try {
          document = await vscode.workspace.openTextDocument(uri);
        } catch {
          continue;
        }
        scanned.add(uri.toString());
        validate(document);
        validateFormDocument(document);
        count += (diagnostics.get(uri)?.length ?? 0) + (formDiagnostics.get(uri)?.length ?? 0);
      }
      return count;
    }
  );

  vscode.window.showInformationMessage(
    `4D CSS: ${found.size} file(s) validated, ${problems} problem(s) found.`
  );
  if (problems) vscode.commands.executeCommand('workbench.action.problems.focus');
}

function schemaPath(context: vscode.ExtensionContext): string {
  const configured = vscode.workspace.getConfiguration('4dCss').get<string>('schemaPath', '');
  if (configured) {
    if (path.isAbsolute(configured)) return configured;
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (root) return path.join(root, configured);
  }
  return path.join(context.extensionPath, 'schema', 'formsSchema.json');
}

function validate(document: vscode.TextDocument): void {
  if (!isCssDocument(document)) return;
  const sheet = parseStylesheet(document.getText());
  diagnostics.set(
    document.uri,
    validateStylesheet(sheet, index).map(item => {
      const range = new vscode.Range(
        document.positionAt(item.offset),
        document.positionAt(item.offset + item.length)
      );
      const diagnostic = new vscode.Diagnostic(
        range,
        item.message,
        item.severity === 'error' ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning
      );
      diagnostic.source = '4D CSS';
      return diagnostic;
    })
  );
}

/** Rule whose declaration block contains `offset`, if any. */
function ruleAt(document: vscode.TextDocument, offset: number): Rule | undefined {
  return parseStylesheet(document.getText()).rules.find(
    rule => offset >= rule.bodyStart && offset <= rule.bodyEnd
  );
}

const completionProvider: vscode.CompletionItemProvider = {
  provideCompletionItems(document, position) {
    const offset = document.offsetAt(position);
    const text = stripComments(document.getText()).slice(0, offset);
    const line = text.slice(text.lastIndexOf('\n') + 1);

    const mediaValue = line.match(/@media[^{]*\(\s*([A-Za-z-]+)\s*:\s*[\w-]*$/);
    if (mediaValue) {
      return (MEDIA_FEATURES.get(mediaValue[1]) ?? []).map(value => valueItem(value, mediaValue[1]));
    }
    if (/@media[^{]*\($/.test(line)) {
      return [...MEDIA_FEATURES.keys()].map(feature => valueItem(feature, 'media feature'));
    }

    const rule = ruleAt(document, offset);
    if (!rule) return selectorCompletions(line);

    const property = line.match(/([A-Za-z_][\w-]*)\s*:[^;{}]*$/);
    if (property) return valueCompletions(rule, property[1]);

    return propertyCompletions(rule);
  }
};

function selectorCompletions(line: string): vscode.CompletionItem[] {
  if (/\[\s*[\w-]*$/.test(line)) {
    const attributes = new Map<string, PropertyInfo>();
    for (const properties of index.values()) for (const [name, info] of properties) attributes.set(name, info);
    return [...attributes.values()].map(info => propertyItem(info, info.name, 'attribute selector'));
  }
  return [...index.keys()].map(type => {
    const item = new vscode.CompletionItem(type, vscode.CompletionItemKind.Class);
    item.detail = '4D object type';
    return item;
  });
}

function propertyCompletions(rule: Rule): vscode.CompletionItem[] {
  const types = analyzeSelector(rule.selector, rule.selectorOffset, index).types;
  const properties = allowedProperties(index, types);
  const scope = types.length ? types.join(', ') : 'all objects';

  const items = [...properties.values()].map(info => {
    const item = propertyItem(info, info.name, scope);
    item.insertText = new vscode.SnippetString(`${info.name}: $0;`);
    return item;
  });

  for (const [cssName, jsonName] of CSS_ALIASES) {
    const info = properties.get(jsonName);
    if (!info) continue;
    const item = propertyItem(info, cssName, `CSS alias of ${jsonName}`);
    item.insertText = new vscode.SnippetString(`${cssName}: $0;`);
    item.sortText = `z${cssName}`;
    items.push(item);
  }
  return items;
}

function valueCompletions(rule: Rule, property: string): vscode.CompletionItem[] {
  const name = CSS_ALIASES.get(property) ?? property;
  if (FORBIDDEN_ATTRIBUTES.has(name)) return [];
  const types = analyzeSelector(rule.selector, rule.selectorOffset, index).types;
  const info = allowedProperties(index, types).get(name);
  if (!info) return [];

  const items = info.enums.map(value => valueItem(value, name));
  if (!info.enums.length && info.types.includes('boolean')) {
    items.push(valueItem('true', name), valueItem('false', name));
  }
  if (info.refs.includes('picture')) {
    const item = new vscode.CompletionItem('url()', vscode.CompletionItemKind.Snippet);
    item.insertText = new vscode.SnippetString('url("$1")');
    item.detail = `Picture path for ${name}`;
    items.push(item);
  }
  return items;
}

function propertyItem(info: PropertyInfo, label: string, scope: string): vscode.CompletionItem {
  const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Property);
  item.detail = `4D CSS · ${scope}`;
  item.documentation = documentation(info);
  return item;
}

function valueItem(label: string, owner: string): vscode.CompletionItem {
  const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Value);
  item.detail = `Value for ${owner}`;
  return item;
}

function documentation(info: PropertyInfo): vscode.MarkdownString {
  const lines: string[] = [];
  if (info.comment) lines.push(info.comment);
  if (info.enums.length) lines.push(`**Values**: ${info.enums.join(' · ')}`);
  else if (info.refs.length) lines.push(`**Type**: ${info.refs.join(', ')}`);
  else if (info.types.length) lines.push(`**Type**: ${info.types.join(', ')}`);
  return new vscode.MarkdownString(lines.join('\n\n'));
}

const hoverProvider: vscode.HoverProvider = {
  provideHover(document, position) {
    const wordRange = document.getWordRangeAtPosition(position, /[A-Za-z_][\w-]*/);
    if (!wordRange) return undefined;
    const word = document.getText(wordRange);
    const offset = document.offsetAt(wordRange.start);
    const rule = ruleAt(document, offset);

    if (!rule && index.has(word)) {
      return new vscode.Hover(
        new vscode.MarkdownString(`**${word}** — 4D object type (${index.get(word)!.size} styleable attributes)`),
        wordRange
      );
    }
    if (!rule) return undefined;

    const name = CSS_ALIASES.get(word) ?? word;
    const types = analyzeSelector(rule.selector, rule.selectorOffset, index).types;
    const info = allowedProperties(index, types).get(name);
    if (!info) return undefined;

    const markdown = new vscode.MarkdownString(`**${name}**\n\n`);
    markdown.appendMarkdown(documentation(info).value);
    return new vscode.Hover(markdown, wordRange);
  }
};
