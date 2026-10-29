/**
 * The ` (backquote) console. Typed commands with Tab completion and
 * persistent history. All behavior lives in the command registry; this is
 * only the text UI.
 */
import { h } from '../client/ui/dom';

const HISTORY_KEY = 'soul-craft:console-history';
const HISTORY_MAX = 100;

export type LineKind = 'in' | 'out' | 'err' | 'info';

export interface ConsoleBackend {
  execute(line: string): Promise<void>;
  complete(line: string): string[];
}

export class DevConsole {
  private readonly el: HTMLElement;
  private readonly log: HTMLElement;
  private readonly input: HTMLInputElement;
  private history: string[] = loadHistory();
  private historyIndex = -1;
  private onToggle: (open: boolean) => void = () => undefined;

  constructor(private readonly backend: ConsoleBackend) {
    this.log = h('div', { class: 'log' });
    this.input = h('input', {
      spellcheck: false,
      autocomplete: 'off',
      placeholder: 'help · Tab completes · ↑↓ history · Esc closes',
    });
    this.el = h('div', { class: 'dev-console hidden' }, this.log, this.input);
    document.body.append(this.el);

    // Capture phase, so the console sees ` and Esc before the game does.
    addEventListener(
      'keydown',
      (e) => {
        if (e.code === 'Backquote') {
          e.preventDefault();
          e.stopPropagation();
          this.toggle();
        } else if (e.code === 'Escape' && this.isOpen) {
          e.preventDefault();
          e.stopPropagation();
          this.toggle(false);
        }
      },
      true,
    );
    this.input.addEventListener('keydown', (e) => this.onKey(e));
  }

  get isOpen(): boolean {
    return !this.el.classList.contains('hidden');
  }

  onOpenChange(fn: (open: boolean) => void): void {
    this.onToggle = fn;
  }

  toggle(open = !this.isOpen): void {
    this.el.classList.toggle('hidden', !open);
    if (open) setTimeout(() => this.input.focus(), 0);
    else this.input.blur();
    this.onToggle(open);
  }

  print(text: string, kind: LineKind = 'out'): void {
    if (!text) return;
    this.log.append(h('div', { class: kind }, text));
    this.log.scrollTop = this.log.scrollHeight;
  }

  clear(): void {
    this.log.textContent = '';
  }

  private onKey(e: KeyboardEvent): void {
    e.stopPropagation();
    switch (e.key) {
      case 'Enter': {
        const line = this.input.value.trim();
        this.input.value = '';
        this.historyIndex = -1;
        if (!line) return;
        this.history = [line, ...this.history.filter((l) => l !== line)].slice(0, HISTORY_MAX);
        saveHistory(this.history);
        this.print(`> ${line}`, 'in');
        void this.backend.execute(line);
        return;
      }
      case 'ArrowUp':
      case 'ArrowDown': {
        e.preventDefault();
        const dir = e.key === 'ArrowUp' ? 1 : -1;
        this.historyIndex = Math.max(-1, Math.min(this.history.length - 1, this.historyIndex + dir));
        this.input.value = this.historyIndex < 0 ? '' : (this.history[this.historyIndex] ?? '');
        return;
      }
      case 'Tab': {
        e.preventDefault();
        this.completeInput();
        return;
      }
    }
  }

  private completeInput(): void {
    const value = this.input.value;
    const options = this.backend.complete(value);
    if (options.length === 0) return;
    const head = value.endsWith(' ') ? value : value.replace(/\S*$/, '');
    const prefix = commonPrefix(options);
    if (options.length === 1) this.input.value = `${head}${options[0]} `;
    else {
      this.input.value = head + prefix;
      this.print(options.join('  '), 'info');
    }
  }
}

function commonPrefix(words: readonly string[]): string {
  let prefix = words[0] ?? '';
  for (const w of words) while (!w.startsWith(prefix)) prefix = prefix.slice(0, -1);
  return prefix;
}

function loadHistory(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function saveHistory(history: string[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch {
    // Storage unavailable (private mode); history just won't persist.
  }
}
