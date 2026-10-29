/**
 * DOM overlay UI. Text-heavy and menu UI lives here (real fonts, real
 * buttons); the pixel HUD is drawn by the renderer.
 */
import type { SaveSlot, SlotInfo } from '../../save/save-manager';
import { TICK_RATE } from '../../sim/constants';
import { classScreen, type ClassScreenOptions } from './classes';
import { SettingsScreen, type SettingsScreenOptions } from './settings';
import { BINDING_GROUPS, DEFAULT_BINDINGS, keyLabel, primaryKey, type Bindings } from '../keybinds';
import { h } from './dom';

/** A class as menus show it: its name, its element's name, and the element's color (CSS). */
export interface ClassLabel {
  name: string;
  element: string;
  color: string;
  /** A new element showing the class's sigil (one per use: an element can only be in one place). */
  sigil(): HTMLElement;
}

/** The sigil, then "Vanguard · Ward", in the element's color. */
function classTag(label: ClassLabel): HTMLElement {
  const el = h('span', { class: 'class-tag' }, label.sigil(), `${label.name} · ${label.element}`);
  el.style.color = label.color;
  return el;
}

export interface TitleHandlers {
  /** The class a save was playing, or null for saves from before classes. */
  classLabel(id: string): ClassLabel | null;
  newGame(slot: SaveSlot): void;
  continueGame(slot: SaveSlot): void;
  deleteSlot(slot: SaveSlot): void;
  settings(): void;
}

export interface PauseHandlers {
  resume(): void;
  settings(): void;
  saveAndQuit(): void;
}

type ScreenKind = 'title' | 'pause' | 'classes' | 'settings';

export class Ui {
  private readonly promptEl = h('div', { class: 'prompt hidden' });
  private readonly toastEl = h('div', { class: 'toast hidden' });
  private readonly fadeEl = h('div', { class: 'fade' });
  private toastTimer = 0;
  private bannerEl: HTMLElement | null = null;
  private areaEl: HTMLElement | null = null;
  private dialogState: { el: HTMLElement; lines: string[]; index: number } | null = null;
  private screenEl: HTMLElement | null = null;
  private screenKind: ScreenKind | null = null;
  /** What Escape does on the open screen, if anything. */
  private screenCancel: (() => void) | null = null;
  private restEl: HTMLElement | null = null;
  private settingsScreen: SettingsScreen | null = null;
  private hintEl: HTMLElement | null = null;
  private hintTimer = 0;
  /** The player's key bindings, for key hints and for advancing dialog. */
  bindings: Bindings = DEFAULT_BINDINGS;

  constructor(private readonly root: HTMLElement) {
    root.append(this.promptEl, this.toastEl, this.fadeEl);
    addEventListener('keydown', (e) => {
      if (!this.dialogState || e.repeat) return;
      if (this.bindings.use.includes(e.code) || this.bindings.attack.includes(e.code)) {
        e.preventDefault();
        this.advanceDialog();
      }
    });
  }

  /** True while a screen or dialog should stop the game from ticking. */
  get blocking(): boolean {
    return this.dialogState !== null || this.screenEl !== null;
  }

  get screen(): ScreenKind | null {
    return this.screenKind;
  }

  /** Escape on a screen that has a way back. Returns false when it has none. */
  cancelScreen(): boolean {
    if (!this.screenCancel) return false;
    this.screenCancel();
    return true;
  }

  showSettings(o: SettingsScreenOptions): void {
    const screen = new SettingsScreen(o);
    this.setScreen('settings', screen.el);
    this.settingsScreen = screen;
    this.screenCancel = () => o.back();
  }

  /** Redraws the settings screen if it is open (e.g. after leaving full screen with F11). */
  refreshSettings(): void {
    this.settingsScreen?.render();
  }

  showClasses(o: ClassScreenOptions): void {
    this.setScreen('classes', classScreen(o));
    this.screenCancel = () => o.cancel();
  }

  /** The bonfire's own menu, shown while resting. Rebuilt only when it appears or the class changes. */
  restMenu(label: ClassLabel | null, changeClass: () => void): void {
    if (!label) {
      this.restEl?.remove();
      this.restEl = null;
      return;
    }
    const key = `${label.name}|${label.element}`;
    if (this.restEl?.dataset.shown === key) return;
    this.restEl?.remove();
    this.restEl = h(
      'div',
      { class: 'rest-menu' },
      h('div', { class: 'title' }, 'Bonfire'),
      classTag(label),
      h('button', { onclick: changeClass }, 'Change class'),
    );
    this.restEl.dataset.shown = key;
    this.root.append(this.restEl);
  }

  /** Called every frame, so the DOM is only rebuilt when the key or text changes. */
  prompt(text: string | null, key?: string): void {
    if (text === null) this.promptEl.classList.add('hidden');
    else {
      const shown = `${key ?? ''}|${text}`;
      if (this.promptEl.dataset.shown !== shown) {
        this.promptEl.dataset.shown = shown;
        this.promptEl.replaceChildren(...(key ? [h('kbd', {}, key), ' '] : []), text);
      }
      this.promptEl.classList.remove('hidden');
    }
  }

  /** A short message; `color` (CSS) tints the text, e.g. a class change in the class's color. */
  toast(text: string, ms = 2600, color?: string): void {
    this.toastEl.textContent = text;
    this.toastEl.style.color = color ?? '';
    this.toastEl.classList.remove('hidden');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.add('hidden'), ms);
  }

  /** A tutorial card above the prompt: a key, what it does, and where to read more. */
  hint(o: {
    key: string;
    title: string;
    text: string;
    footer: string;
    color: string;
    icon?: HTMLElement;
  }): void {
    this.hintEl?.remove();
    const title = h('div', { class: 'title' }, o.title);
    title.style.color = o.color;
    this.hintEl = h(
      'div',
      { class: 'hint-card' },
      h('div', { class: 'keys' }, o.icon ?? null, h('kbd', {}, o.key)),
      h('div', {}, title, h('div', { class: 'text' }, o.text), h('div', { class: 'footer' }, o.footer)),
    );
    this.root.append(this.hintEl);
    clearTimeout(this.hintTimer);
    this.hintTimer = window.setTimeout(() => {
      this.hintEl?.remove();
      this.hintEl = null;
    }, 9000);
  }

  /** Closes the tutorial card, e.g. when a menu opens over it. */
  clearHint(): void {
    clearTimeout(this.hintTimer);
    this.hintEl?.remove();
    this.hintEl = null;
  }

  area(name: string): void {
    this.areaEl?.remove();
    this.areaEl = h('div', { class: 'area' }, name);
    this.root.append(this.areaEl);
  }

  banner(text: string, kind: 'death' | 'good'): void {
    this.bannerEl?.remove();
    this.bannerEl = h(
      'div',
      { class: `banner ${kind}` },
      h('div', { class: 'band' }),
      h('div', { class: 'text' }, text),
    );
    this.root.append(this.bannerEl);
  }

  fade(on: boolean): void {
    this.fadeEl.classList.toggle('on', on);
  }

  dialog(lines: string[]): void {
    if (lines.length === 0) return;
    this.closeDialog();
    const el = h(
      'div',
      { class: 'dialog', onclick: () => this.advanceDialog() },
      h('div', { class: 'text' }),
      h('div', { class: 'more' }, h('kbd', {}, primaryKey(this.bindings, 'use')), ' ▸'),
    );
    this.root.append(el);
    this.dialogState = { el, lines, index: 0 };
    this.renderDialog();
  }

  private advanceDialog(): void {
    const d = this.dialogState;
    if (!d) return;
    if (++d.index >= d.lines.length) this.closeDialog();
    else this.renderDialog();
  }

  private renderDialog(): void {
    const d = this.dialogState;
    if (!d) return;
    const text = d.el.querySelector('.text');
    if (text) text.textContent = d.lines[d.index] ?? '';
  }

  closeDialog(): void {
    this.dialogState?.el.remove();
    this.dialogState = null;
  }

  showTitle(slots: readonly SlotInfo[], handlers: TitleHandlers, footer: string): void {
    const rows = slots.map((s) => {
      const cls = s.meta?.playerClass ? handlers.classLabel(s.meta.playerClass) : null;
      const label = h(
        'div',
        { class: 'info' },
        h('div', { class: 'name' }, `Slot ${s.slot}`, cls ? ' ' : null, cls ? classTag(cls) : null),
      );
      const buttons: HTMLElement[] = [];
      if (s.meta) {
        const when = new Date(s.meta.savedAt).toLocaleString();
        label.append(
          h(
            'div',
            { class: 'meta' },
            `${s.meta.location} · ${formatTicks(s.meta.playTicks)} · ${s.meta.souls} souls · ${when}`,
          ),
        );
        buttons.push(h('button', { onclick: () => handlers.continueGame(s.slot) }, 'Continue'));
        buttons.push(
          h(
            'button',
            {
              class: 'quiet',
              onclick: () => {
                if (confirm(`Delete slot ${s.slot}? This cannot be undone.`)) handlers.deleteSlot(s.slot);
              },
            },
            'Delete',
          ),
        );
      } else {
        if (s.error) label.append(h('div', { class: 'error' }, `Unreadable save: ${s.error}`));
        else label.append(h('div', { class: 'meta' }, 'Empty'));
        buttons.push(
          h('button', { onclick: () => handlers.newGame(s.slot) }, s.error ? 'Overwrite' : 'New game'),
        );
      }
      return h('div', { class: 'slot' }, label, ...buttons);
    });
    this.setScreen(
      'title',
      h(
        'div',
        { class: 'screen' },
        h('h1', {}, 'SOUL CRAFT'),
        h('div', { class: 'sub' }, 'kindle the flame, and walk the waking lands'),
        h('div', { class: 'slots' }, ...rows),
        h('button', { class: 'quiet', onclick: () => handlers.settings() }, 'Settings'),
        h('div', { class: 'hint' }, controlsLine(this.bindings)),
        footer ? h('div', { class: 'hint' }, footer) : null,
      ),
    );
  }

  showPause(handlers: PauseHandlers, cls: ClassLabel | null): void {
    this.setScreen(
      'pause',
      h(
        'div',
        { class: 'screen' },
        h('h1', {}, 'PAUSED'),
        cls ? h('div', { class: 'sub' }, classTag(cls)) : null,
        h(
          'div',
          { class: 'menu' },
          h('button', { onclick: () => handlers.resume() }, 'Resume'),
          h('button', { onclick: () => handlers.settings() }, 'Settings'),
          h('button', { onclick: () => handlers.saveAndQuit() }, 'Save & quit to title'),
        ),
        controlsPanel(this.bindings),
      ),
    );
  }

  hideScreen(): void {
    this.settingsScreen?.dispose();
    this.settingsScreen = null;
    this.screenEl?.remove();
    this.screenEl = null;
    this.screenKind = null;
    this.screenCancel = null;
  }

  /** Clears transient in-game UI (used when leaving or switching worlds). */
  resetHud(): void {
    this.prompt(null);
    this.closeDialog();
    this.fade(false);
    this.areaEl?.remove();
    this.bannerEl?.remove();
    this.restMenu(null, () => undefined);
    this.clearHint();
  }

  private setScreen(kind: ScreenKind, el: HTMLElement): void {
    this.hideScreen();
    this.clearHint();
    this.screenEl = el;
    this.screenKind = kind;
    this.root.append(el);
    el.querySelector('button')?.focus();
  }
}

/** Every control and its key, for the pause screen. */
function controlsPanel(b: Bindings): HTMLElement {
  return h(
    'div',
    { class: 'controls-panel' },
    ...BINDING_GROUPS.map((g) =>
      h(
        'div',
        { class: 'bind-group' },
        h('h3', {}, g.title),
        ...g.rows.map((r) =>
          h(
            'div',
            { class: 'row' },
            h('span', { class: 'what' }, r.label),
            ...(b[r.binding].length > 0
              ? b[r.binding].map((k) => h('kbd', {}, keyLabel(k)))
              : [h('span', {}, '—')]),
          ),
        ),
      ),
    ),
  );
}

/** The title screen's one-line key reminder, from the current bindings. */
function controlsLine(b: Bindings): string {
  const k = (binding: Parameters<typeof primaryKey>[1]) => primaryKey(b, binding);
  const move = [k('up'), k('left'), k('down'), k('right')].join('');
  const abilities = [k('aoe'), k('classAbility'), k('super')].join(' / ');
  return [
    `${move} move`,
    `${k('attack')} / click attack`,
    `${k('roll')} roll`,
    `${abilities} abilities`,
    `${k('heal')} flask`,
    `${k('item')} quick item`,
    `${k('use')} use`,
    `${k('inventory')} pack`,
    'Esc pause and settings',
  ].join(' · ');
}

export function formatTicks(ticks: number): string {
  const s = Math.floor(ticks / TICK_RATE);
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return hh > 0 ? `${hh}:${String(mm).padStart(2, '0')}:${ss}` : `${mm}:${ss}`;
}
