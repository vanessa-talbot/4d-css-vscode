import * as vscode from 'vscode';

import { CSS_ALIASES, MEDIA_FEATURES, ObjectIndex, PropertyInfo } from './schema';

interface PropertyDoc {
  name: string;
  cssAliases: string[];
  types: string[];
  enums: string[];
  refs: string[];
  freeForm: boolean;
  comment?: string;
}

interface ObjectDoc {
  type: string;
  properties: PropertyDoc[];
}

interface MediaFeatureDoc {
  name: string;
  values: string[];
}

export class DocumentationViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = '4dCss.documentation';

  private view?: vscode.WebviewView;
  private activeObjectType?: string;

  constructor(
    private index: ObjectIndex,
    private readonly insertProperty: (name: string) => void | Thenable<void>,
    private readonly insertMediaFeature: (name: string, value: string) => void | Thenable<void>
  ) {}

  updateIndex(index: ObjectIndex): void {
    this.index = index;
    this.postDocs();
  }

  updateActiveObjectType(type: string | undefined): void {
    if (this.activeObjectType === type) return;
    this.activeObjectType = type;
    this.postActiveObjectType();
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.onDidReceiveMessage(message => {
      if (message?.type === 'insertProperty' && typeof message.name === 'string') {
        void this.insertProperty(message.name);
      }
      if (
        message?.type === 'insertMediaFeature' &&
        typeof message.name === 'string' &&
        typeof message.value === 'string'
      ) {
        void this.insertMediaFeature(message.name, message.value);
      }
    });
    view.webview.html = this.html(view.webview);
  }

  private postDocs(): void {
    this.view?.webview.postMessage({
      type: 'docs',
      docs: this.docs(),
      mediaFeatures: this.mediaFeatures(),
      activeObjectType: this.activeObjectType
    });
  }

  private postActiveObjectType(): void {
    this.view?.webview.postMessage({ type: 'activeObjectType', activeObjectType: this.activeObjectType });
  }

  private docs(): ObjectDoc[] {
    return [...this.index.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([type, properties]) => ({
        type,
        properties: [...properties.values()]
          .sort((left, right) => left.name.localeCompare(right.name))
          .map(info => this.propertyDoc(info))
      }));
  }

  private propertyDoc(info: PropertyInfo): PropertyDoc {
    const cssAliases = [...CSS_ALIASES.entries()]
      .filter(([, jsonName]) => jsonName === info.name)
      .map(([cssName]) => cssName)
      .sort();

    return {
      name: info.name,
      cssAliases,
      types: info.types,
      enums: info.enums,
      refs: info.refs,
      freeForm: info.freeForm,
      comment: info.comment
    };
  }

  private mediaFeatures(): MediaFeatureDoc[] {
    return [...MEDIA_FEATURES.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, values]) => ({ name, values: [...values] }));
  }

  private html(webview: vscode.Webview): string {
    const nonce = randomNonce();
    const docs = scriptJson(this.docs());
    const mediaFeatures = scriptJson(this.mediaFeatures());
    const activeObjectType = scriptJson(this.activeObjectType);

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>4D CSS Reference</title>
  <style>
    :root {
      color-scheme: light dark;
      --gap: 10px;
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      padding: 12px;
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }

    label {
      display: block;
      margin-bottom: 4px;
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
      text-transform: uppercase;
    }

    select,
    input {
      width: 100%;
      height: 28px;
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 2px;
      padding: 3px 7px;
      color: var(--vscode-input-foreground);
      background: var(--vscode-input-background);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }

    select:focus,
    input:focus {
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: -1px;
    }

    .control + .control { margin-top: var(--gap); }

    .tabs {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 2px;
      margin-bottom: 12px;
      padding: 2px;
      border-radius: 4px;
      background: var(--vscode-editorGroupHeader-tabsBackground, var(--vscode-sideBarSectionHeader-background));
    }

    .tab {
      border: 0;
      border-radius: 3px;
      padding: 5px 4px;
      color: var(--vscode-foreground);
      background: transparent;
      font-family: var(--vscode-font-family);
      font-size: 12px;
      cursor: pointer;
    }

    .tab.active {
      color: var(--vscode-tab-activeForeground);
      background: var(--vscode-tab-activeBackground, var(--vscode-editor-background));
    }

    .tab:focus {
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: -1px;
    }

    .panel[hidden] { display: none; }

    .summary {
      margin: 12px 0 8px;
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
    }

    .property-list,
    .reference-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .property,
    .reference {
      border: 1px solid var(--vscode-sideBarSectionHeader-border, var(--vscode-panel-border));
      border-radius: 4px;
      padding: 7px;
      background: var(--vscode-editor-background);
    }

    .property-header,
    .reference-header {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 5px;
    }

    .property-actions {
      display: flex;
      flex: 0 1 auto;
      align-items: center;
      justify-content: flex-end;
      gap: 5px;
      max-width: 55%;
    }

    .property-name,
    .reference-name {
      min-width: 0;
      margin: 0;
      color: var(--vscode-symbolIcon-propertyForeground, var(--vscode-foreground));
      font-family: var(--vscode-editor-font-family);
      font-size: 12px;
      font-weight: 600;
      word-break: break-word;
    }

    .property-type,
    .reference-type {
      flex: 0 1 auto;
      max-width: 100%;
      border-radius: 3px;
      padding: 1px 0;
      color: var(--vscode-descriptionForeground);
      background: transparent;
      font-size: 11px;
      line-height: 1.35;
      overflow: hidden;
      text-align: right;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .insert-property,
    .insert-reference {
      flex: 0 0 auto;
      width: 20px;
      height: 20px;
      border: 1px solid var(--vscode-button-border, transparent);
      border-radius: 3px;
      padding: 0;
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
      font-family: var(--vscode-font-family);
      font-size: 14px;
      line-height: 18px;
      cursor: pointer;
    }

    .insert-property:hover,
    .insert-reference:hover {
      background: var(--vscode-button-hoverBackground);
    }

    .insert-property:focus,
    .insert-reference:focus {
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: -1px;
    }

    .aliases,
    .enums,
    .comment,
    .syntax,
    .description,
    .empty {
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
      line-height: 1.4;
      overflow-wrap: anywhere;
    }

    .enums {
      margin-top: 5px;
    }

    .syntax + .description,
    .description + .syntax {
      margin-top: 5px;
    }

    .comment {
      margin-top: 5px;
      color: var(--vscode-foreground);
    }

    code {
      font-family: var(--vscode-editor-font-family);
      color: var(--vscode-textLink-foreground);
    }
  </style>
</head>
<body>
  <div class="tabs" role="tablist" aria-label="4D CSS reference sections">
    <button class="tab active" type="button" role="tab" aria-selected="true" data-tab="objects">Objects</button>
    <button class="tab" type="button" role="tab" aria-selected="false" data-tab="selectors">Selectors</button>
    <button class="tab" type="button" role="tab" aria-selected="false" data-tab="media">@media</button>
  </div>

  <div id="objectsPanel" class="panel">
    <div class="control">
      <label for="objectType">Object type</label>
      <select id="objectType"></select>
    </div>
    <div class="control">
      <label for="filter">Filter properties</label>
      <input id="filter" type="search" placeholder="property, type, enum...">
    </div>
    <div id="summary" class="summary"></div>
    <div id="properties" class="property-list"></div>
  </div>

  <div id="selectorsPanel" class="panel" hidden>
    <div class="summary">Selectors supported by 4D style sheets.</div>
    <div id="selectors" class="reference-list"></div>
  </div>

  <div id="mediaPanel" class="panel" hidden>
    <div class="summary">Media features supported by 4D style sheets.</div>
    <div id="mediaFeatures" class="reference-list"></div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const tabs = [...document.querySelectorAll('.tab')];
    const panels = {
      objects: document.getElementById('objectsPanel'),
      selectors: document.getElementById('selectorsPanel'),
      media: document.getElementById('mediaPanel')
    };
    const objectType = document.getElementById('objectType');
    const filter = document.getElementById('filter');
    const summary = document.getElementById('summary');
    const properties = document.getElementById('properties');
    const selectors = document.getElementById('selectors');
    const mediaFeaturesElement = document.getElementById('mediaFeatures');
    let docs = ${docs};
    let mediaFeatures = ${mediaFeatures};
    let activeObjectType = ${activeObjectType};

    window.addEventListener('message', event => {
      if (event.data?.type === 'docs') {
        docs = event.data.docs;
        mediaFeatures = event.data.mediaFeatures;
        activeObjectType = event.data.activeObjectType;
        renderTypes();
        selectActiveObjectType();
        renderProperties();
        renderMediaFeatures();
      }
      if (event.data?.type === 'activeObjectType') {
        activeObjectType = event.data.activeObjectType;
        selectActiveObjectType();
        renderProperties();
      }
    });

    for (const tab of tabs) {
      tab.addEventListener('click', () => activateTab(tab.dataset.tab));
    }
    objectType.addEventListener('change', renderProperties);
    filter.addEventListener('input', renderProperties);

    renderTypes();
    selectActiveObjectType();
    renderProperties();
    renderSelectors();
    renderMediaFeatures();

    function activateTab(name) {
      for (const tab of tabs) {
        const active = tab.dataset.tab === name;
        tab.classList.toggle('active', active);
        tab.setAttribute('aria-selected', String(active));
      }
      for (const [panelName, panel] of Object.entries(panels)) {
        panel.hidden = panelName !== name;
      }
    }

    function renderTypes() {
      const selected = objectType.value;
      objectType.textContent = '';
      for (const doc of docs) {
        const option = document.createElement('option');
        option.value = doc.type;
        option.textContent = doc.type;
        objectType.append(option);
      }
      if (docs.some(doc => doc.type === selected)) objectType.value = selected;
    }

    function selectActiveObjectType() {
      if (!activeObjectType || !docs.some(doc => doc.type === activeObjectType)) return;
      objectType.value = activeObjectType;
    }

    function renderProperties() {
      const doc = docs.find(item => item.type === objectType.value) ?? docs[0];
      if (!doc) {
        summary.textContent = 'No object types found in the schema.';
        properties.textContent = '';
        return;
      }

      if (objectType.value !== doc.type) objectType.value = doc.type;
      const query = filter.value.trim().toLowerCase();
      const visible = doc.properties.filter(property => matches(property, query));
      summary.textContent = visible.length + '/' + doc.properties.length + ' properties for ' + doc.type;
      properties.textContent = '';

      if (!visible.length) {
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = 'No matching properties.';
        properties.append(empty);
        return;
      }

      for (const property of visible) properties.append(renderProperty(property));
    }

    function matches(property, query) {
      if (!query) return true;
      return [
        property.name,
        ...property.cssAliases,
        ...property.types,
        ...property.refs,
        ...property.enums,
        property.comment ?? ''
      ].some(value => value.toLowerCase().includes(query));
    }

    function renderProperty(property) {
      const item = document.createElement('section');
      item.className = 'property';

      const header = document.createElement('div');
      header.className = 'property-header';

      const title = document.createElement('h3');
      title.className = 'property-name';
      title.textContent = property.name;
      header.append(title);

      const propertyType = document.createElement('span');
      propertyType.className = 'property-type';
      propertyType.textContent = typeLabel(property);

      const actions = document.createElement('div');
      actions.className = 'property-actions';
      actions.append(propertyType);

      const insert = document.createElement('button');
      insert.className = 'insert-property';
      insert.type = 'button';
      insert.title = 'Insert property at cursor';
      insert.setAttribute('aria-label', 'Insert ' + property.name + ' at cursor');
      insert.textContent = '+';
      insert.addEventListener('click', () => vscode.postMessage({ type: 'insertProperty', name: property.name }));
      actions.append(insert);

      header.append(actions);

      item.append(header);

      if (property.cssAliases.length) {
        const aliases = document.createElement('div');
        aliases.className = 'aliases';
        aliases.innerHTML = 'CSS alias: ' + property.cssAliases.map(code).join(', ');
        item.append(aliases);
      }

      if (property.enums.length) {
        const enums = document.createElement('div');
        enums.className = 'enums';
        enums.innerHTML = 'Enum: ' + property.enums.map(code).join(', ');
        item.append(enums);
      }

      if (property.comment) {
        const comment = document.createElement('div');
        comment.className = 'comment';
        comment.textContent = property.comment;
        item.append(comment);
      }

      return item;
    }

    function typeLabel(property) {
      const values = property.refs.length ? property.refs : property.types;
      const label = values.length ? values.join(', ') : 'any';
      return property.freeForm && property.enums.length ? label + ' + free' : label;
    }

    function renderSelectors() {
      selectors.textContent = '';
      const items = [
        {
          name: 'Object type',
          type: 'button',
          syntax: ['button { ... }'],
          description: 'Targets every form object whose type matches the selector name.'
        },
        {
          name: 'Class',
          type: '.primary',
          syntax: ['.primary { ... }', 'button.primary { ... }'],
          description: 'Targets objects whose class attribute contains the class name.'
        },
        {
          name: 'Identifier',
          type: '#name',
          syntax: ['#okButton { ... }', 'button#okButton { ... }'],
          description: 'Targets an object by name.'
        },
        {
          name: 'Attribute',
          type: '[attr=value]',
          syntax: ['[type=button] { ... }', 'button[style=toolbar] { ... }'],
          description: 'Supports existence checks and the =, ~= and |= operators.'
        },
        {
          name: 'Universal',
          type: '*',
          syntax: ['* { ... }'],
          description: 'Targets all styleable objects.'
        },
        {
          name: 'Combinators',
          type: '> + ~ space',
          syntax: ['form button { ... }', 'groupBox > button { ... }'],
          description: 'The parser accepts descendant, child and sibling combinators in selectors.'
        },
        {
          name: 'Selector lists',
          type: ',',
          syntax: ['button, input { ... }'],
          description: 'Applies the same declaration block to multiple selectors.'
        }
      ];
      for (const item of items) selectors.append(renderReference(item));
    }

    function renderMediaFeatures() {
      mediaFeaturesElement.textContent = '';
      for (const feature of mediaFeatures) {
        mediaFeaturesElement.append(renderReference({
          name: feature.name,
          type: '@media',
          syntax: ['@media (' + feature.name + ': ' + feature.values[0] + ') { ... }'],
          description: 'Values: ' + feature.values.join(', '),
          insert: { type: 'media', value: feature.values[0] }
        }));
      }
    }

    function renderReference(item) {
      const section = document.createElement('section');
      section.className = 'reference';

      const header = document.createElement('div');
      header.className = 'reference-header';

      const title = document.createElement('h3');
      title.className = 'reference-name';
      title.textContent = item.name;
      header.append(title);

      const type = document.createElement('span');
      type.className = 'reference-type';
      type.textContent = item.type;

      if (item.insert) {
        const actions = document.createElement('div');
        actions.className = 'property-actions';
        actions.append(type);

        const insert = document.createElement('button');
        insert.className = 'insert-reference';
        insert.type = 'button';
        insert.title = 'Insert at cursor';
        insert.setAttribute('aria-label', 'Insert ' + item.name + ' at cursor');
        insert.textContent = '+';
        insert.addEventListener('click', () => {
          vscode.postMessage({ type: 'insertMediaFeature', name: item.name, value: item.insert.value });
        });
        actions.append(insert);
        header.append(actions);
      } else {
        header.append(type);
      }
      section.append(header);

      const syntax = document.createElement('div');
      syntax.className = 'syntax';
      syntax.innerHTML = item.syntax.map(code).join('<br>');
      section.append(syntax);

      const description = document.createElement('div');
      description.className = 'description';
      description.textContent = item.description;
      section.append(description);

      return section;
    }

    function code(text) {
      const element = document.createElement('code');
      element.textContent = text;
      return element.outerHTML;
    }
  </script>
</body>
</html>`;
  }
}

function randomNonce(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let value = '';
  for (let i = 0; i < 32; i++) value += alphabet[Math.floor(Math.random() * alphabet.length)];
  return value;
}

function scriptJson(value: unknown): string {
  return (JSON.stringify(value) ?? 'null').replace(/</g, '\\u003c');
}
