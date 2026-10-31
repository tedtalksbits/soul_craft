/**
 * Turns keyboard and mouse into one InputFrame per simulation tick. Presses
 * accumulate until a tick consumes them, so a tap is never lost between
 * render frames.
 */
import { Action, type ActionName, type InputFrame, type PlayerAction } from '../sim/input';
import { DEFAULT_BINDINGS, type Binding, type Bindings } from './keybinds';

/** Ability keys aim at the mouse cursor, like a click does. */
const AIMED = Action.aoe | Action.classAbility | Action.super;
/**
 * The AoE (a thrown grenade, a slam) is hold-to-aim: pressing its key starts aiming and shows
 * where it will land; releasing it throws. Right-click cancels.
 */
const HOLD_TO_AIM: ActionName = 'aoe';

const CAPTURED = new Set(['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
const ACTIONS = Object.keys(Action) as ActionName[];

export class InputCapture {
  /** When false, game input is ignored (a menu or the console has focus). */
  enabled = true;
  /** The player's key bindings (from settings). */
  bindings: Bindings = DEFAULT_BINDINGS;
  private readonly held = new Set<string>();
  private pressed = 0;
  private aim: { x: number; y: number } | null = null;
  /** Where the mouse last was over the game, in client pixels; null until it moves there. */
  private pointer: { x: number; y: number } | null = null;
  private actions: PlayerAction[] = [];
  private aiming = false;

  constructor(
    target: HTMLElement,
    private readonly toWorld: (clientX: number, clientY: number) => { x: number; y: number },
  ) {
    addEventListener('keydown', (e) => {
      if (isTyping(e) || !this.enabled) return;
      if (CAPTURED.has(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.held.add(e.code);
      for (const a of ACTIONS) {
        if (!this.bindings[a].includes(e.code)) continue;
        if (a === HOLD_TO_AIM) {
          this.aiming = true;
          continue;
        }
        this.pressed |= Action[a];
        if (Action[a] & AIMED && this.pointer) this.aim = this.toWorld(this.pointer.x, this.pointer.y);
      }
    });
    target.addEventListener('mousemove', (e) => (this.pointer = { x: e.clientX, y: e.clientY }));
    target.addEventListener('mouseleave', () => (this.pointer = null));
    addEventListener('keyup', (e) => {
      this.held.delete(e.code);
      if (!this.aiming || !this.bindings[HOLD_TO_AIM].includes(e.code)) return;
      this.aiming = false;
      if (!this.enabled) return;
      this.pressed |= Action[HOLD_TO_AIM];
      if (this.pointer) this.aim = this.toWorld(this.pointer.x, this.pointer.y);
    });
    addEventListener('blur', () => {
      this.held.clear();
      this.aiming = false;
    });
    target.addEventListener('mousedown', (e) => {
      if (e.button === 2) this.aiming = false; // right-click cancels a held throw
      if (!this.enabled || e.button !== 0) return;
      this.pressed |= Action.attack;
      this.aim = this.toWorld(e.clientX, e.clientY);
    });
    target.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /**
   * Queues a menu action (equip, craft...) for the next tick. Actions go through even while
   * game input is held, since the menu holding it is where they come from.
   */
  queueAction(action: PlayerAction): void {
    this.actions.push(action);
  }

  /**
   * While the AoE key is held: where it would land, the cursor in world pixels (null if the
   * mouse is off the game, so the throw goes the way the player faces). Undefined when not aiming.
   */
  get aimPreview(): { x: number; y: number } | null | undefined {
    if (!this.aiming || !this.enabled) return undefined;
    return this.pointer ? this.toWorld(this.pointer.x, this.pointer.y) : null;
  }

  /** The frame for the next tick. Clears accumulated presses. */
  consume(): InputFrame {
    const on = (b: Binding) => this.enabled && this.bindings[b].some((k) => this.held.has(k));
    let held = 0;
    for (const a of ACTIONS) if (on(a)) held |= Action[a];
    const frame: InputFrame = {
      moveX: (on('right') ? 1 : 0) - (on('left') ? 1 : 0),
      moveY: (on('down') ? 1 : 0) - (on('up') ? 1 : 0),
      aim: this.aim,
      pressed: this.pressed,
      held,
      ...(this.actions.length > 0 ? { actions: this.actions } : {}),
    };
    this.pressed = 0;
    this.aim = null;
    this.actions = [];
    return frame;
  }

  /** Forget everything, e.g. when a menu opens mid-press. */
  reset(): void {
    this.held.clear();
    this.pressed = 0;
    this.aim = null;
    this.actions = [];
    this.aiming = false;
  }
}

export function isTyping(e: Event): boolean {
  const t = e.target;
  return t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement;
}
