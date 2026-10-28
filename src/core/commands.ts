/**
 * Typed command registry behind the dev console, scenario URLs and tests.
 *
 * Feature modules contribute their own commands, so adding a feature never
 * means editing a central switch statement. Parsing is strict: a bad argument
 * is reported, never silently coerced.
 */

export type ArgSpec<Ctx> =
  | { name: string; type: 'number'; optional?: boolean; integer?: boolean }
  | { name: string; type: 'bool'; optional?: boolean }
  | { name: string; type: 'string'; optional?: boolean; options?: (ctx: Ctx) => readonly string[] }
  /** Swallows the remainder of the line verbatim. Must be last. */
  | { name: string; type: 'rest'; optional?: boolean };

export interface CommandDef<Ctx> {
  name: string;
  aliases?: readonly string[];
  description: string;
  args?: readonly ArgSpec<Ctx>[];
  /** Returns text to print, or nothing. Throw {@link CommandError} for user-facing failures. */
  // eslint-disable-next-line @typescript-eslint/no-invalid-void-type -- commands may print nothing
  run(ctx: Ctx, args: ParsedArgs): string | void | Promise<string | void>;
}

export class CommandError extends Error {}

export class ParsedArgs {
  constructor(private readonly values: ReadonlyMap<string, number | boolean | string>) {}

  number(name: string): number {
    return this.required(name, 'number');
  }
  string(name: string): string {
    return this.required(name, 'string');
  }
  bool(name: string): boolean {
    return this.required(name, 'boolean');
  }
  optNumber(name: string): number | undefined {
    return this.optional(name, 'number');
  }
  optString(name: string): string | undefined {
    return this.optional(name, 'string');
  }
  optBool(name: string): boolean | undefined {
    return this.optional(name, 'boolean');
  }

  private required<K extends 'number' | 'string' | 'boolean'>(name: string, kind: K): KindValue<K> {
    const v = this.optional(name, kind);
    if (v === undefined) throw new CommandError(`missing argument <${name}>`);
    return v;
  }

  private optional<K extends 'number' | 'string' | 'boolean'>(
    name: string,
    kind: K,
  ): KindValue<K> | undefined {
    const v = this.values.get(name);
    if (v === undefined) return undefined;
    if (typeof v !== kind) throw new Error(`argument <${name}> is ${typeof v}, not ${kind}`);
    return v as KindValue<K>;
  }
}

type KindValue<K> = K extends 'number' ? number : K extends 'boolean' ? boolean : string;

export interface CommandResult {
  ok: boolean;
  output: string;
}

const TRUE_WORDS = new Set(['1', 'on', 'true', 'yes']);
const FALSE_WORDS = new Set(['0', 'off', 'false', 'no']);

export function tokenize(line: string): string[] {
  const tokens: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  for (const m of line.matchAll(re)) tokens.push(m[1] ?? m[2] ?? m[3] ?? '');
  return tokens;
}

/** Splits a script on `;` and newlines, ignoring blank lines and `#` comments. */
export function splitScript(script: string): string[] {
  return script
    .split(/[;\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith('#'));
}

export class CommandRegistry<Ctx> {
  private readonly byName = new Map<string, CommandDef<Ctx>>();
  private readonly primary: CommandDef<Ctx>[] = [];

  register(...defs: readonly CommandDef<Ctx>[]): this {
    for (const def of defs) {
      for (const key of [def.name, ...(def.aliases ?? [])]) {
        if (this.byName.has(key)) throw new Error(`Command "${key}" is registered twice`);
        this.byName.set(key, def);
      }
      this.primary.push(def);
    }
    return this;
  }

  list(): readonly CommandDef<Ctx>[] {
    return [...this.primary].sort((a, b) => a.name.localeCompare(b.name));
  }

  find(name: string): CommandDef<Ctx> | undefined {
    return this.byName.get(name);
  }

  async execute(ctx: Ctx, line: string): Promise<CommandResult> {
    const tokens = tokenize(line.trim());
    const [name, ...rest] = tokens;
    if (name === undefined) return { ok: true, output: '' };
    const def = this.byName.get(name);
    if (!def) return { ok: false, output: `unknown command "${name}". Try "help".` };
    try {
      const args = this.parse(ctx, def, rest);
      const out = await def.run(ctx, args);
      return { ok: true, output: out ?? '' };
    } catch (err) {
      if (err instanceof CommandError) return { ok: false, output: `${name}: ${err.message}\n${usage(def)}` };
      throw err;
    }
  }

  /** Runs each statement of a script in order and stops at the first failure. */
  async executeScript(ctx: Ctx, script: string): Promise<CommandResult[]> {
    const results: CommandResult[] = [];
    for (const line of splitScript(script)) {
      const r = await this.execute(ctx, line);
      results.push(r);
      if (!r.ok) break;
    }
    return results;
  }

  /** Completion candidates for the token under the cursor (the end of `line`). */
  complete(ctx: Ctx, line: string): string[] {
    const tokens = tokenize(line);
    if (line.endsWith(' ') || tokens.length === 0) tokens.push('');
    const current = tokens[tokens.length - 1] ?? '';
    if (tokens.length === 1) {
      return [...this.byName.keys()].filter((n) => n.startsWith(current)).sort();
    }
    const def = this.byName.get(tokens[0] ?? '');
    const spec = def?.args?.[tokens.length - 2];
    if (!spec) return [];
    const options =
      spec.type === 'string' && spec.options ? spec.options(ctx) : spec.type === 'bool' ? ['on', 'off'] : [];
    return options.filter((o) => o.startsWith(current));
  }

  private parse(ctx: Ctx, def: CommandDef<Ctx>, tokens: string[]): ParsedArgs {
    const values = new Map<string, number | boolean | string>();
    const specs = def.args ?? [];
    for (let i = 0; i < specs.length; i++) {
      const spec = specs[i];
      if (!spec) continue;
      if (spec.type === 'rest') {
        const remainder = tokens.slice(i);
        if (remainder.length > 0) values.set(spec.name, remainder.join(' '));
        else if (!spec.optional) throw new CommandError(`missing argument <${spec.name}>`);
        return new ParsedArgs(values);
      }
      const raw = tokens[i];
      if (raw === undefined) {
        if (!spec.optional) throw new CommandError(`missing argument <${spec.name}>`);
        continue;
      }
      switch (spec.type) {
        case 'number': {
          const n = Number(raw);
          if (!Number.isFinite(n)) throw new CommandError(`<${spec.name}> must be a number, got "${raw}"`);
          if (spec.integer && !Number.isInteger(n))
            throw new CommandError(`<${spec.name}> must be a whole number, got "${raw}"`);
          values.set(spec.name, n);
          break;
        }
        case 'bool':
          if (TRUE_WORDS.has(raw)) values.set(spec.name, true);
          else if (FALSE_WORDS.has(raw)) values.set(spec.name, false);
          else throw new CommandError(`<${spec.name}> must be on/off, got "${raw}"`);
          break;
        case 'string': {
          const options = spec.options?.(ctx);
          if (options && !options.includes(raw))
            throw new CommandError(`<${spec.name}> must be one of: ${options.join(', ')}`);
          values.set(spec.name, raw);
          break;
        }
      }
    }
    if (tokens.length > specs.length) throw new CommandError(`too many arguments`);
    return new ParsedArgs(values);
  }
}

export function usage<Ctx>(def: CommandDef<Ctx>): string {
  const args = (def.args ?? []).map((a) => (a.optional ? `[${a.name}]` : `<${a.name}>`)).join(' ');
  return `usage: ${def.name}${args ? ' ' + args : ''}`;
}
