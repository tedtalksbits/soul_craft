/**
 * In-game content editor (F10 or `edit`). Edits apply live once the whole
 * content set validates; "Save" writes the file back through the dev server,
 * which also triggers the normal hot-reload path.
 */
import type { App } from '../client/app';
import { h } from '../client/ui/dom';
import { buildContent, ContentError } from '../content/content';
import { CONTENT_WRITE_ENDPOINT } from './protocol';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Path = (string | number)[];

export class ContentEditor {
  private readonly el: HTMLElement;
  private readonly select: HTMLSelectElement;
  private readonly status: HTMLElement;
  private readonly tree: HTMLElement;
  private path = '';
  private draft: Json = null;
  private original: Json = null;
  private dirty = false;

  constructor(private readonly app: App) {
    this.select = h('select', { onchange: () => this.open(this.select.value) });
    this.status = h('div', { class: 'status' });
    this.tree = h('div', { class: 'tree' });
    this.el = h(
      'div',
      { class: 'dev-editor hidden' },
      h(
        'header',
        {},
        this.select,
        h('button', { onclick: () => void this.save(), title: 'Write this file to disk' }, 'Save'),
        h('button', { onclick: () => this.revert(), title: 'Discard unsaved edits' }, 'Revert'),
        h('button', { onclick: () => this.toggle(false) }, '×'),
      ),
      this.status,
      this.tree,
    );
    document.body.append(this.el);
  }

  get isOpen(): boolean {
    return !this.el.classList.contains('hidden');
  }

  toggle(open = !this.isOpen, file?: string): void {
    this.el.classList.toggle('hidden', !open);
    if (!open) return;
    const files = Object.keys(this.app.content.files).sort();
    this.select.replaceChildren(...files.map((f) => h('option', { value: f }, f)));
    const target = file ?? (this.path || files[0] || '');
    if (target) this.open(target);
  }

  files(): string[] {
    return Object.keys(this.app.content.files).sort();
  }

  private open(path: string): void {
    if (!(path in this.app.content.files)) {
      this.setStatus(`no content file "${path}"`, 'error');
      return;
    }
    this.path = path;
    this.select.value = path;
    this.original = structuredClone(this.app.content.files[path]) as Json;
    this.draft = structuredClone(this.original);
    this.dirty = false;
    this.render();
    this.setStatus(`${path}: edits apply live; Save writes to disk`);
  }

  private revert(): void {
    if (!this.path) return;
    this.draft = structuredClone(this.original);
    this.apply();
    this.dirty = false;
    this.render();
    this.setStatus('reverted');
  }

  private async save(): Promise<void> {
    if (!this.path) return;
    if (!import.meta.env.DEV) return this.setStatus('saving needs the dev server (pnpm dev)', 'error');
    const res = await fetch(CONTENT_WRITE_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: this.path, data: this.draft }),
    });
    if (!res.ok) return this.setStatus(`save failed: ${await res.text()}`, 'error');
    this.original = structuredClone(this.draft);
    this.dirty = false;
    this.setStatus(`saved content/${this.path}`, 'ok');
  }

  private apply(): void {
    try {
      const content = buildContent({ ...this.app.content.files, [this.path]: this.draft });
      this.app.setContent(content);
      this.setStatus(this.dirty ? 'applied (unsaved)' : 'applied', 'ok');
    } catch (err) {
      if (!(err instanceof ContentError)) throw err;
      this.setStatus(err.problems.join('\n'), 'error');
    }
  }

  private set(path: Path, value: Json): void {
    let node = this.draft as Record<string | number, Json>;
    for (const key of path.slice(0, -1)) node = node[key] as Record<string | number, Json>;
    node[path[path.length - 1]!] = value;
    this.dirty = true;
    this.apply();
  }

  private render(): void {
    this.tree.replaceChildren(...this.nodes(this.draft, []));
  }

  private nodes(value: Json, path: Path): HTMLElement[] {
    if (value !== null && typeof value === 'object') {
      const entries: [string | number, Json][] = Array.isArray(value)
        ? value.map((v, i) => [i, v])
        : Object.entries(value);
      return entries.map(([key, child]) => {
        const childPath = [...path, key];
        if (child !== null && typeof child === 'object') {
          const details = h('details', {}, h('summary', {}, describe(key, child)));
          details.open = path.length === 0 && entries.length < 6;
          details.addEventListener('toggle', () => {
            if (details.open && details.children.length === 1)
              details.append(...this.nodes(child, childPath));
          });
          if (details.open) details.append(...this.nodes(child, childPath));
          return details;
        }
        return this.field(String(key), child, childPath);
      });
    }
    return [this.field('(value)', value, path)];
  }

  private field(label: string, value: Json, path: Path): HTMLElement {
    let input: HTMLInputElement;
    if (typeof value === 'number') {
      input = h('input', { type: 'number', step: 'any', value: String(value) });
      input.addEventListener('change', () => {
        const n = Number(input.value);
        if (Number.isFinite(n)) this.set(path, n);
      });
    } else if (typeof value === 'boolean') {
      input = h('input', { type: 'checkbox', checked: value });
      input.addEventListener('change', () => this.set(path, input.checked));
    } else {
      input = h('input', { type: 'text', value: typeof value === 'string' ? value : '' });
      input.addEventListener('change', () => this.set(path, input.value));
    }
    return h('div', { class: 'field' }, h('label', {}, label), input);
  }

  private setStatus(text: string, kind?: 'ok' | 'error'): void {
    this.status.textContent = text;
    this.status.className = `status ${kind ?? ''}`;
  }
}

function describe(key: string | number, value: Json): string {
  if (Array.isArray(value)) return `${key} [${value.length}]`;
  if (value !== null && typeof value === 'object') {
    const name = (value as Record<string, Json>)['name'] ?? (value as Record<string, Json>)['id'];
    return typeof name === 'string' ? `${key} · ${name}` : String(key);
  }
  return String(key);
}
