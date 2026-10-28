import { describe, expect, it } from 'vitest';
import { CommandError, CommandRegistry, splitScript, tokenize } from '../../src/core/commands';

interface Ctx {
  log: string[];
}

function registry() {
  return new CommandRegistry<Ctx>().register(
    {
      name: 'give',
      aliases: ['g'],
      description: 'give things',
      args: [
        { name: 'what', type: 'string', options: () => ['souls', 'flasks'] },
        { name: 'amount', type: 'number', integer: true, optional: true },
      ],
      run: (ctx, a) => {
        ctx.log.push(`${a.string('what')}:${a.optNumber('amount') ?? 1}`);
        return 'ok';
      },
    },
    {
      name: 'fail',
      description: 'always fails',
      run: () => {
        throw new CommandError('nope');
      },
    },
  );
}

describe('CommandRegistry', () => {
  it('parses typed arguments and aliases', async () => {
    const ctx: Ctx = { log: [] };
    expect((await registry().execute(ctx, 'give souls 50')).ok).toBe(true);
    await registry().execute(ctx, 'g flasks');
    expect(ctx.log).toEqual(['souls:50', 'flasks:1']);
  });

  it('rejects bad arguments with usage instead of running', async () => {
    const ctx: Ctx = { log: [] };
    const r = await registry().execute(ctx, 'give gold 1.5');
    expect(r.ok).toBe(false);
    expect(r.output).toMatch(/must be one of: souls, flasks/);
    expect(r.output).toMatch(/usage: give <what> \[amount\]/);
    expect((await registry().execute(ctx, 'give souls 1.5')).output).toMatch(/whole number/);
    expect((await registry().execute(ctx, 'give souls 1 2')).output).toMatch(/too many/);
    expect(ctx.log).toEqual([]);
  });

  it('stops a script at the first failure', async () => {
    const ctx: Ctx = { log: [] };
    const results = await registry().executeScript(ctx, 'give souls 1; fail; give souls 2');
    expect(results.map((r) => r.ok)).toEqual([true, false]);
    expect(ctx.log).toEqual(['souls:1']);
  });

  it('completes command names and enum arguments', () => {
    const r = registry();
    expect(r.complete({ log: [] }, 'gi')).toEqual(['give']);
    expect(r.complete({ log: [] }, 'give s')).toEqual(['souls']);
    expect(r.complete({ log: [] }, 'give ')).toEqual(['souls', 'flasks']);
  });

  it('refuses duplicate names', () => {
    expect(() => registry().register({ name: 'g', description: '', run: () => undefined })).toThrow(/twice/);
  });
});

describe('tokenize / splitScript', () => {
  it('honours quotes and comments', () => {
    expect(tokenize(`say "hello there" 'x y' z`)).toEqual(['say', 'hello there', 'x y', 'z']);
    expect(splitScript('a 1; b\n# comment\n\nc')).toEqual(['a 1', 'b', 'c']);
  });
});
