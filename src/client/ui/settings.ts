/**
 * The settings screen: controls (with rebinding), display and audio. It edits
 * a Settings value through `change`; the app applies and stores it.
 */
import {
  BINDING_GROUPS,
  DEFAULT_BINDINGS,
  isReserved,
  keyLabel,
  KEYS_PER_BINDING,
  rebind,
  unbind,
  type Binding,
} from '../keybinds';
import type { Settings } from '../settings';
import { h } from './dom';

export interface SettingsScreenOptions {
  settings(): Settings;
  change(update: Partial<Settings>): void;
  /** Whether the browser is showing the game full screen now. */
  isFullscreen(): boolean;
  toggleFullscreen(): void;
  back(): void;
}

const BINDING_NAMES: ReadonlyMap<Binding, string> = new Map(
  BINDING_GROUPS.flatMap((g) => g.rows.map((r) => [r.binding, r.label] as const)),
);

/** The live screen. `render` rebuilds it in place after any change. */
export class SettingsScreen {
  readonly el = h('div', { class: 'screen settings' });
  /** The key slot waiting for a key press, if any. */
  private listening: { binding: Binding; slot: number } | null = null;
  private notice = '';
  private readonly onKey = (e: KeyboardEvent) => this.capture(e);

  constructor(private readonly o: SettingsScreenOptions) {
    // Capture phase, ahead of the game's own keys (pause, inventory), so the press only rebinds.
    addEventListener('keydown', this.onKey, { capture: true });
    this.render();
  }

  /** Applies a change and redraws. (The volume slider applies without redrawing, so a drag isn't cut off.) */
  private set(update: Partial<Settings>): void {
    this.o.change(update);
    this.render();
  }

  /** Stop listening for keys; call when the screen closes. */
  dispose(): void {
    removeEventListener('keydown', this.onKey, { capture: true });
  }

  render(): void {
    const s = this.o.settings();
    const scroll = this.el.querySelector('.panel')?.scrollTop ?? 0;
    this.el.replaceChildren(
      h('h1', {}, 'SETTINGS'),
      h(
        'div',
        { class: 'panel' },
        this.controls(s),
        h('h2', {}, 'Display'),
        toggle('Fill the screen', s.fill, 'Show a little more of the world instead of black borders.', () =>
          this.set({ fill: !s.fill }),
        ),
        h(
          'div',
          { class: 'row' },
          h('div', { class: 'what' }, 'Full screen', h('div', { class: 'note' }, 'Or press F11.')),
          h(
            'button',
            { onclick: () => this.o.toggleFullscreen() },
            this.o.isFullscreen() ? 'Leave' : 'Enter',
          ),
        ),
        h('h2', {}, 'Audio'),
        h(
          'div',
          { class: 'row' },
          h('div', { class: 'what' }, 'Volume'),
          volumeSlider(s.volume, (volume) => this.o.change({ volume })),
        ),
        toggle('Mute', s.muted, '', () => this.set({ muted: !s.muted })),
        h('h2', {}, 'Tutorial'),
        h(
          'div',
          { class: 'row' },
          h(
            'div',
            { class: 'what' },
            'Hints',
            h('div', { class: 'note' }, 'Ability hints show once each. Show them again from the start.'),
          ),
          h(
            'button',
            { disabled: s.seenHints.length === 0, onclick: () => this.set({ seenHints: [] }) },
            'Show again',
          ),
        ),
      ),
      h('button', { class: 'quiet', onclick: () => this.o.back() }, 'Back (Esc)'),
    );
    const panel = this.el.querySelector('.panel');
    if (panel) panel.scrollTop = scroll;
  }

  private controls(s: Settings): HTMLElement {
    const groups = BINDING_GROUPS.map((g) =>
      h(
        'div',
        { class: 'bind-group' },
        h('h3', {}, g.title),
        ...g.rows.map((r) => {
          const keys = s.bindings[r.binding];
          const cells = Array.from({ length: KEYS_PER_BINDING }, (_, slot) => {
            const waiting = this.listening?.binding === r.binding && this.listening.slot === slot;
            const code = keys[slot];
            return h(
              'button',
              {
                class: waiting ? 'key waiting' : 'key',
                title: 'Click, then press a key. Backspace clears.',
                onclick: () => {
                  this.listening = { binding: r.binding, slot: Math.min(slot, keys.length) };
                  this.notice = '';
                  this.render();
                },
              },
              waiting ? 'Press a key…' : code ? keyLabel(code) : '—',
            );
          });
          return h('div', { class: 'row' }, h('div', { class: 'what' }, r.label), ...cells);
        }),
      ),
    );
    return h(
      'div',
      { class: 'controls' },
      h('h2', {}, 'Controls'),
      h(
        'p',
        { class: 'note' },
        'Click a key to change it. Esc pauses, and opens this screen, and cannot be changed.',
      ),
      this.notice ? h('p', { class: 'notice' }, this.notice) : null,
      h('div', { class: 'bind-groups' }, ...groups),
      h(
        'button',
        {
          onclick: () => {
            this.listening = null;
            this.notice = 'Controls reset to the defaults.';
            this.set({ bindings: DEFAULT_BINDINGS });
          },
        },
        'Reset controls',
      ),
    );
  }

  /** A key press while waiting for one: bind it, clear the slot, or cancel. */
  private capture(e: KeyboardEvent): void {
    const target = this.listening;
    if (!target) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    this.listening = null;
    const s = this.o.settings();
    if (e.code === 'Escape') {
      this.notice = '';
    } else if (e.code === 'Backspace' || e.code === 'Delete') {
      this.notice = '';
      this.set({ bindings: unbind(s.bindings, target.binding, target.slot) });
      return;
    } else if (isReserved(e.code)) {
      this.notice = `${keyLabel(e.code)} is kept for the game itself (pause, dev tools, the browser).`;
    } else {
      const { bindings, tookFrom } = rebind(s.bindings, target.binding, target.slot, e.code);
      this.notice = tookFrom
        ? `${keyLabel(e.code)} moved here from ${BINDING_NAMES.get(tookFrom) ?? tookFrom}.`
        : '';
      this.set({ bindings });
      return;
    }
    this.render();
  }
}

function toggle(label: string, on: boolean, note: string, flip: () => void): HTMLElement {
  return h(
    'div',
    { class: 'row' },
    h('div', { class: 'what' }, label, note ? h('div', { class: 'note' }, note) : null),
    h('button', { class: on ? 'toggle on' : 'toggle', onclick: flip }, on ? 'On' : 'Off'),
  );
}

function volumeSlider(value: number, set: (v: number) => void): HTMLElement {
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const input = h('input', {
    type: 'range',
    min: '0',
    max: '100',
    step: '5',
    value: String(Math.round(value * 100)),
  });
  const shown = h('span', {}, pct(value));
  input.setAttribute('aria-label', 'Volume');
  input.oninput = () => {
    const v = Number(input.value) / 100;
    shown.textContent = pct(v);
    set(v);
  };
  return h('div', { class: 'volume' }, input, shown);
}
