/**
 * Runs the Python art generators in tools/art inside their own venv.
 *
 *   pnpm art:setup            create tools/art/.venv and install requirements.txt
 *   pnpm art <tool> [args]    run tools/art/<tool>.py, then format the sprite JSON it wrote
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { format, resolveConfig } from 'prettier';
import { ROOT } from './lib/load-content';

const ART = join(ROOT, 'tools', 'art');
const VENV = join(ART, '.venv');
const VENV_PYTHON = join(VENV, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const SPRITES = join(ROOT, 'assets', 'sprites');

function run(cmd: string, args: string[]): void {
  const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: ROOT });
  if (r.error) throw r.error;
  if (r.status !== 0) process.exit(r.status ?? 1);
}

function systemPython(): string {
  for (const candidate of ['python3', 'python']) {
    if (spawnSync(candidate, ['--version'], { stdio: 'ignore' }).status === 0) return candidate;
  }
  throw new Error('Python 3 is required for the art tools (https://www.python.org/downloads/)');
}

/** Python's json.dumps layout differs from Prettier's; normalize so lint-staged stays happy. */
async function formatSpriteJson(): Promise<void> {
  for (const name of readdirSync(SPRITES).filter((f) => f.endsWith('.json'))) {
    const file = join(SPRITES, name);
    const text = readFileSync(file, 'utf8');
    const next = await format(text, { ...(await resolveConfig(file)), filepath: file });
    if (next !== text) writeFileSync(file, next);
  }
}

const [command, ...rest] = process.argv.slice(2);
if (command === 'setup') {
  if (!existsSync(VENV)) run(systemPython(), ['-m', 'venv', VENV]);
  run(VENV_PYTHON, [
    '-m',
    'pip',
    'install',
    '--disable-pip-version-check',
    '-r',
    join(ART, 'requirements.txt'),
  ]);
} else if (command === 'run' && rest[0]) {
  const [tool, ...args] = rest;
  const script = join(ART, `${tool}.py`);
  if (!existsSync(script)) throw new Error(`No art tool "${tool}" (expected ${script})`);
  if (!existsSync(VENV_PYTHON)) throw new Error('Art tools are not set up yet. Run: pnpm art:setup');
  run(VENV_PYTHON, [script, ...args]);
  await formatSpriteJson();
} else {
  console.error('usage: pnpm art:setup | pnpm art <tool> [args]');
  process.exit(1);
}
