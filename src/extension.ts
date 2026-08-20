import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import { Rule, parseStylesheet, stripComments } from './parser';
import {
  CSS_ALIASES,
  FORBIDDEN_ATTRIBUTES,
  MEDIA_FEATURES,
  ObjectIndex,
  PropertyInfo,
  buildIndex
} from './schema';
import { allowedProperties, analyzeSelector, validateStylesheet } from './validator';

const LANGUAGE = '4d-css';

let index: ObjectIndex = new Map();
let diagnostics: vscode.DiagnosticCollection;

export function activate(context: vscode.ExtensionContext) {
  diagnostics = vscode.languages.createDiagnosticCollection(LANGUAGE);
  context.subscriptions.push(diagnostics);

  const reload = () => {
    try {
      index = buildIndex(JSON.parse(fs.readFileSync(schemaPath(context), 'utf8')));
      for (const document of vscode.workspace.textDocuments) validate(document);
    } catch (error) {
      vscode.window.showErrorMessage(`4D CSS: unable to load schema: ${String(error)}`);
    }
  };
  reload();

  context.subscriptions.push(
    vscode.commands.registerCommand('4dCss.reloadSchema', reload),
    vscode.workspace.onDidChangeTextDocument(event => validate(event.document)),
    vscode.workspace.onDidOpenTextDocument(validate),
    vscode.workspace.onDidCloseTextDocument(document => diagnostics.delete(document.uri)),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('4dCss.schemaPath')) reload();
    }),
    vscode.languages.registerCompletionItemProvider(LANGUAGE, completionProvider, '.', '#', '[', ':', ' ', '('),
    vscode.languages.registerHoverProvider(LANGUAGE, hoverProvider)
  );
}

export function deactivate() {
  diagnostics?.dispose();
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
  if (document.languageId !== LANGUAGE) return;
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
