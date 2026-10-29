/**
 * Developer tooling, loaded only in dev builds or with `?dev`:
 * console + commands, overlays, content editor, snapshots, hot reload and
 * scenario URLs. See docs/dev-tools.md for the full reference.
 */
import './dev.css';
import type { App } from '../client/app';
import { randomSeed } from '../client/app';
import { Assets } from '../client/assets';
import { fetchContentFile } from '../client/content-source';
import { CommandError, CommandRegistry, usage, type CommandDef } from '../core/commands';
import { buildContent, ContentError } from '../content/content';
import { parseSave, type SaveFile } from '../save/format';
import { SAVE_SLOTS, type SaveSlot } from '../save/save-manager';
import { SIM_MODULES } from '../sim/modules';
import type { Simulation } from '../sim/simulation';
import { DevConsole } from './console';
import { ContentEditor } from './content-editor';
import { OVERLAY_KEYS, OVERLAYS, Overlays, type OverlayName } from './overlays';
import { FILE_CHANGED_EVENT, type FileChangedPayload } from './protocol';

export interface DevContext {
  /** The running simulation. Throws a CommandError when no game is running. */
  readonly sim: Simulation;
  readonly app: App;
  readonly dev: DevTools;
}

type DevCommand = CommandDef<DevContext>;

const QUICK_SNAPSHOT = 'quick';

export class DevTools {
  readonly registry = new CommandRegistry<DevContext>();
  readonly console: DevConsole;
  readonly overlays: Overlays;
  readonly editor: ContentEditor;

  constructor(readonly app: App) {
    for (const m of SIM_MODULES) this.registry.register(...(m.commands ?? []));
    this.registry.register(...devCommands);
    this.console = new DevConsole({
      execute: (line) => this.run(line).then(() => undefined),
      complete: (line) => this.registry.complete(this.context, line),
    });
    this.console.onOpenChange((open) =>
      open ? app.inputHolds.add('console') : app.inputHolds.delete('console'),
    );
    this.overlays = new Overlays(app);
    this.editor = new ContentEditor(app);
    this.bindKeys();
    this.bindDragAndDrop();
    this.bindHotReload();
  }

  get context(): DevContext {
    const app = this.app;
    return {
      app,
      dev: this,
      get sim(): Simulation {
        if (!app.sim) throw new CommandError('no game is running (start one with "newgame" or a slot)');
        return app.sim;
      },
    };
  }

  /** Runs a command line (or `;`-separated script) and prints the result. */
  async run(script: string): Promise<boolean> {
    for (const r of await this.registry.executeScript(this.context, script)) {
      this.console.print(r.output, r.ok ? 'out' : 'err');
      if (!r.ok) {
        if (!this.console.isOpen) this.app.ui.toast(`Command failed: ${r.output.split('\n')[0] ?? ''}`, 4000);
        return false;
      }
    }
    return true;
  }

  async takeSnapshot(name: string): Promise<void> {
    if (!this.app.sim) throw new CommandError('no game is running');
    await this.app.snapshots.take(this.app.sim, name);
  }

  async restoreSnapshot(name: string): Promise<void> {
    const file = await this.app.snapshots.get(name);
    if (!file) throw new CommandError(`no snapshot "${name}"`);
    this.app.loadSave(file, null);
  }

  private bindKeys(): void {
    addEventListener('keydown', (e) => {
      if (e.repeat || this.console.isOpen) return;
      const overlay = OVERLAY_KEYS[e.code];
      if (overlay) {
        e.preventDefault();
        this.overlays.set(overlay, !this.overlays.enabled[overlay]);
        return;
      }
      const action = {
        F6: () => (this.app.loop.paused = !this.app.loop.paused),
        F7: () => this.app.loop.step(1),
        F8: () =>
          this.takeSnapshot(QUICK_SNAPSHOT).then(() => this.app.ui.toast('Snapshot saved (F9 restores)')),
        F9: () => this.restoreSnapshot(QUICK_SNAPSHOT).then(() => this.app.ui.toast('Snapshot restored')),
        F10: () => this.editor.toggle(),
      }[e.code];
      if (!action) return;
      e.preventDefault();
      void Promise.resolve(action()).catch((err: unknown) =>
        this.app.ui.toast(err instanceof Error ? err.message : String(err)),
      );
    });
  }

  private bindDragAndDrop(): void {
    addEventListener('dragover', (e) => e.preventDefault());
    addEventListener('drop', (e) => {
      e.preventDefault();
      const file = e.dataTransfer?.files[0];
      if (file) void this.importFile(file);
    });
  }

  async importFile(file: File): Promise<void> {
    try {
      const save = parseSave(JSON.parse(await file.text()));
      this.app.loadSave(save, null);
      this.app.ui.toast(`Loaded ${file.name}`);
    } catch (err) {
      this.app.ui.toast(
        `Could not load ${file.name}: ${err instanceof Error ? err.message : String(err)}`,
        5000,
      );
    }
  }

  private bindHotReload(): void {
    if (!import.meta.hot) return;
    import.meta.hot.on(FILE_CHANGED_EVENT, (payload: FileChangedPayload) => void this.onFileChanged(payload));
  }

  private async onFileChanged({ path, type }: FileChangedPayload): Promise<void> {
    try {
      if (path.startsWith('/content/') && path.endsWith('.json')) {
        const rel = path.slice('/content/'.length);
        const files = Object.fromEntries(Object.entries(this.app.content.files).filter(([p]) => p !== rel));
        if (type !== 'delete') files[rel] = await fetchContentFile(rel);
        this.app.setContent(buildContent(files));
        this.console.print(`reloaded content/${rel}`, 'info');
        this.app.ui.toast(`Reloaded content/${rel}`, 1500);
      } else if (path.startsWith('/assets/sprites/') && type !== 'delete') {
        const name = Assets.sheetNameFromPath(path);
        await this.app.assets.reload(name);
        this.console.print(`reloaded sprite sheet ${name}`, 'info');
        this.app.ui.toast(`Reloaded sprites: ${name}`, 1500);
      }
    } catch (err) {
      const message =
        err instanceof ContentError ? err.message : err instanceof Error ? err.message : String(err);
      this.console.print(message, 'err');
      this.app.ui.toast('Content error: open the console (`) for details', 4000);
    }
  }
}

function download(name: string, data: unknown): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function pickFile(): Promise<File | undefined> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = () => resolve(input.files?.[0]);
    input.click();
  });
}

const slotArg = { name: 'slot', type: 'string', options: () => [...SAVE_SLOTS] } as const;

const devCommands: DevCommand[] = [
  {
    name: 'help',
    description: 'List commands, or describe one.',
    args: [{ name: 'command', type: 'string', optional: true }],
    run: ({ dev }, a) => {
      const name = a.optString('command');
      if (name) {
        const def = dev.registry.find(name);
        if (!def) throw new CommandError(`no command "${name}"`);
        return `${usage(def)}\n${def.description}${def.aliases?.length ? `\naliases: ${def.aliases.join(', ')}` : ''}`;
      }
      const width = Math.max(...dev.registry.list().map((d) => d.name.length));
      return [
        ...dev.registry.list().map((d) => `${d.name.padEnd(width)}  ${d.description}`),
        '',
        'Keys: ` console · F1 hitboxes · F2 ai · F3 chunks · F4 stats · F5 solids · F6 pause · F7 step · F8/F9 snapshot · F10 editor',
      ].join('\n');
    },
  },
  {
    name: 'cls',
    description: 'Clear the console.',
    run: ({ dev }) => dev.console.clear(),
  },
  {
    name: 'overlay',
    description: 'Toggle a debug overlay, or list them.',
    args: [
      { name: 'name', type: 'string', optional: true, options: () => [...OVERLAYS] },
      { name: 'on', type: 'bool', optional: true },
    ],
    run: ({ dev }, a) => {
      const name = a.optString('name') as OverlayName | undefined;
      if (!name) return OVERLAYS.map((o) => `${o}: ${dev.overlays.enabled[o] ? 'on' : 'off'}`).join('\n');
      dev.overlays.set(name, a.optBool('on') ?? !dev.overlays.enabled[name]);
      return `${name} ${dev.overlays.enabled[name] ? 'on' : 'off'}`;
    },
  },
  {
    name: 'timescale',
    aliases: ['ts'],
    description: 'Simulation speed multiplier (e.g. 0.25 for slow motion).',
    args: [{ name: 'scale', type: 'number' }],
    run: ({ app }, a) => {
      const s = a.number('scale');
      if (s <= 0 || s > 8) throw new CommandError('scale must be in (0, 8]');
      app.loop.timeScale = s;
      return `timescale ${s}`;
    },
  },
  {
    name: 'pause',
    description: 'Freeze the simulation (F6). Use "step" to advance.',
    args: [{ name: 'on', type: 'bool', optional: true }],
    run: ({ app }, a) => {
      app.loop.paused = a.optBool('on') ?? !app.loop.paused;
      return app.loop.paused ? 'paused' : 'running';
    },
  },
  {
    name: 'step',
    description: 'Advance N ticks while paused (F7 steps one).',
    args: [{ name: 'ticks', type: 'number', integer: true, optional: true }],
    run: ({ app }, a) => {
      app.loop.paused = true;
      app.loop.step(a.optNumber('ticks') ?? 1);
    },
  },
  {
    name: 'snap',
    description: 'Snapshots: snap save|load|delete <name>, snap list, snap export [name], snap import.',
    args: [
      {
        name: 'action',
        type: 'string',
        options: () => ['save', 'load', 'list', 'delete', 'export', 'import'],
      },
      { name: 'name', type: 'string', optional: true },
    ],
    run: async ({ app, dev }, a) => {
      const name = a.optString('name') ?? QUICK_SNAPSHOT;
      switch (a.string('action')) {
        case 'save':
          await dev.takeSnapshot(name);
          return `saved snapshot "${name}"`;
        case 'load':
          await dev.restoreSnapshot(name);
          return `restored snapshot "${name}"`;
        case 'list': {
          const names = await app.snapshots.names();
          return names.length ? names.join('\n') : '(no snapshots)';
        }
        case 'delete':
          await app.snapshots.delete(name);
          return `deleted snapshot "${name}"`;
        case 'export': {
          let file: SaveFile | undefined;
          if (a.optString('name')) file = await app.snapshots.get(name);
          else if (app.sim) file = await app.snapshots.take(app.sim, `export-${Date.now()}`);
          if (!file) throw new CommandError(`no snapshot "${name}"`);
          download(`soul-craft-${file.meta.slot.replace(/[^a-z0-9-]/gi, '_')}.json`, file);
          return 'downloaded';
        }
        default: {
          const picked = await pickFile();
          if (picked) await dev.importFile(picked);
          return;
        }
      }
    },
  },
  {
    name: 'save',
    description: 'Save the game now, to its slot or the one given.',
    args: [{ ...slotArg, optional: true }],
    run: async ({ app }, a) => {
      const slot = a.optString('slot') as SaveSlot | undefined;
      if (slot) app.slot = slot;
      if (!app.slot) throw new CommandError('this game has no slot; pass one, e.g. "save 1"');
      if (!(await app.save())) throw new CommandError('cannot save right now (dead or no game)');
      return `saved to slot ${app.slot}`;
    },
  },
  {
    name: 'load',
    description: 'Load a save slot.',
    args: [slotArg],
    run: async ({ app }, a) => {
      await app.continueSlot(a.string('slot') as SaveSlot);
      return `loaded slot ${a.string('slot')}`;
    },
  },
  {
    name: 'newgame',
    description: 'Start a scratch game (no save slot), optionally with a seed.',
    args: [{ name: 'seed', type: 'number', integer: true, optional: true }],
    run: async ({ app }, a) => {
      const sim = await app.newGame(null, a.optNumber('seed') ?? randomSeed());
      return `new world, seed ${sim.state.seed}`;
    },
  },
  {
    name: 'scenario',
    description: 'Start a scenario from content/scenarios.',
    args: [{ name: 'name', type: 'string', options: ({ app }) => Object.keys(app.content.scenarios) }],
    run: async ({ dev }, a) => {
      await startScenario(dev, a.string('name'));
    },
  },
  {
    name: 'edit',
    description: 'Open the content editor (F10), optionally on a file.',
    args: [
      { name: 'file', type: 'string', optional: true, options: ({ app }) => Object.keys(app.content.files) },
    ],
    run: ({ dev }, a) => dev.editor.toggle(true, a.optString('file')),
  },
  {
    name: 'title',
    description: 'Return to the title screen without saving.',
    run: async ({ app }) => {
      await app.showTitle();
    },
  },
  {
    name: 'mute',
    description: 'Toggle sound.',
    run: ({ app }) => {
      app.settings.update({ muted: !app.settings.current.muted });
      return app.settings.current.muted ? 'muted' : 'unmuted';
    },
  },
];

async function startScenario(dev: DevTools, name: string, seedOverride?: number): Promise<void> {
  const scenario = dev.app.content.scenarios[name];
  if (!scenario) throw new CommandError(`no scenario "${name}"`);
  await dev.app.newGame(null, seedOverride ?? scenario.seed ?? randomSeed());
  if (scenario.commands.length > 0) await dev.run(scenario.commands.join(';'));
  dev.app.ui.toast(`Scenario: ${name}`, 2000);
}

/**
 * URL parameters (dev only):
 *   ?scenario=<name>   boot into content/scenarios/<name>.json
 *   ?new [&seed=<n>]   boot straight into a scratch world
 *   ?slot=<1-3>        continue a save slot
 *   ?cmd=<script>      run console commands after boot (`;`-separated)
 *   ?overlay=a,b       enable overlays
 */
async function applyUrl(dev: DevTools, params: URLSearchParams): Promise<void> {
  const seedParam = params.get('seed');
  const seed = seedParam === null ? undefined : Number(seedParam);
  const scenario = params.get('scenario');
  const slot = params.get('slot');
  if (scenario) await startScenario(dev, scenario, seed);
  else if (slot && (SAVE_SLOTS as readonly string[]).includes(slot))
    await dev.app.continueSlot(slot as SaveSlot);
  else if (params.has('new') || seed !== undefined) await dev.app.newGame(null, seed ?? randomSeed());
  else await dev.app.showTitle();

  for (const o of (params.get('overlay') ?? '').split(','))
    if ((OVERLAYS as readonly string[]).includes(o)) dev.overlays.set(o as OverlayName, true);
  const cmd = params.get('cmd');
  if (cmd) await dev.run(cmd);
}

export async function installDevTools(app: App, params: URLSearchParams): Promise<DevTools> {
  const dev = new DevTools(app);
  app.setTitleFooter('Dev build · press ` for the console · F1-F5 overlays · F10 content editor');
  Object.assign(window, { dev, app });
  try {
    await applyUrl(dev, params);
  } catch (err) {
    dev.console.print(err instanceof Error ? err.message : String(err), 'err');
    await app.showTitle();
  }
  return dev;
}
