/**
 * DOM overlay UI. Text-heavy and menu UI lives here (real fonts, real
 * buttons); the pixel HUD is drawn by the renderer.
 */
import type { SaveSlot, SlotInfo } from '../../save/save-manager';
import { TICK_RATE } from '../../sim/constants';
import { h } from './dom';

export interface TitleHandlers {
  newGame(slot: SaveSlot): void;
  continueGame(slot: SaveSlot): void;
  deleteSlot(slot: SaveSlot): void;
}

export interface PauseHandlers {
  resume(): void;
  saveAndQuit(): void;
}

export class Ui {
  private readonly promptEl = h('div', { class: 'prompt hidden' });
  private readonly toastEl = h('div', { class: 'toast hidden' });
  private readonly fadeEl = h('div', { class: 'fade' });
  private toastTimer = 0;
  private bannerEl: HTMLElement | null = null;
  private areaEl: HTMLElement | null = null;
  private dialogState: { el: HTMLElement; lines: string[]; index: number } | null = null;
  private screenEl: HTMLElement | null = null;
  private screenKind: 'title' | 'pause' | null = null;

  constructor(private readonly root: HTMLElement) {
    root.append(this.promptEl, this.toastEl, this.fadeEl);
    addEventListener('keydown', (e) => {
      if (!this.dialogState || e.repeat) return;
      if (['KeyE', 'Enter', 'Space', 'KeyJ'].includes(e.code)) {
        e.preventDefault();
        this.advanceDialog();
      }
    });
  }

  /** True while a screen or dialog should stop the game from ticking. */
  get blocking(): boolean {
    return this.dialogState !== null || this.screenEl !== null;
  }

  get screen(): 'title' | 'pause' | null {
    return this.screenKind;
  }

  prompt(text: string | null): void {
    if (text === null) this.promptEl.classList.add('hidden');
    else {
      if (this.promptEl.textContent !== text) this.promptEl.textContent = text;
      this.promptEl.classList.remove('hidden');
    }
  }

  toast(text: string, ms = 2600): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.remove('hidden');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.add('hidden'), ms);
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
      h('div', { class: 'more' }, 'E ▸'),
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
      const label = h('div', { class: 'info' }, h('div', { class: 'name' }, `Slot ${s.slot}`));
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
        h(
          'div',
          { class: 'hint' },
          'WASD move · J / click attack · Shift roll · F / C / V abilities · R flask · Q quick item · E use · Tab pack · Esc pause',
        ),
        footer ? h('div', { class: 'hint' }, footer) : null,
      ),
    );
  }

  showPause(handlers: PauseHandlers): void {
    this.setScreen(
      'pause',
      h(
        'div',
        { class: 'screen' },
        h('h1', {}, 'PAUSED'),
        h(
          'div',
          { class: 'menu' },
          h('button', { onclick: () => handlers.resume() }, 'Resume'),
          h('button', { onclick: () => handlers.saveAndQuit() }, 'Save & quit to title'),
        ),
      ),
    );
  }

  hideScreen(): void {
    this.screenEl?.remove();
    this.screenEl = null;
    this.screenKind = null;
  }

  /** Clears transient in-game UI (used when leaving or switching worlds). */
  resetHud(): void {
    this.prompt(null);
    this.closeDialog();
    this.fade(false);
    this.areaEl?.remove();
    this.bannerEl?.remove();
  }

  private setScreen(kind: 'title' | 'pause', el: HTMLElement): void {
    this.hideScreen();
    this.screenEl = el;
    this.screenKind = kind;
    this.root.append(el);
    el.querySelector('button')?.focus();
  }
}

export function formatTicks(ticks: number): string {
  const s = Math.floor(ticks / TICK_RATE);
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return hh > 0 ? `${hh}:${String(mm).padStart(2, '0')}:${ss}` : `${mm}:${ss}`;
}
