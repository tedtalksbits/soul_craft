import './client/ui/styles.css';
import { App } from './client/app';
import { Assets } from './client/assets';
import { bundledContentFiles } from './client/content-source';
import { GameRenderer } from './client/render/renderer';
import { preloadUiKit } from './client/ui/ui-kit';
import { buildContent, ContentError } from './content/content';

async function boot(): Promise<void> {
  const wrap = document.getElementById('wrap');
  const stage = document.getElementById('stage');
  const uiRoot = document.getElementById('ui');
  if (!wrap || !stage || !uiRoot) throw new Error('index.html is missing #wrap, #stage or #ui');

  const content = buildContent(bundledContentFiles());
  const [assets] = await Promise.all([Assets.load(), preloadUiKit()]);
  const renderer = await GameRenderer.create(wrap, stage, assets);
  const app = new App(content, assets, renderer, uiRoot);

  const params = new URLSearchParams(location.search);
  const devEnabled = import.meta.env.DEV || params.has('dev');
  if (devEnabled) {
    const { installDevTools } = await import('./dev/dev-tools');
    await installDevTools(app, params);
  } else {
    await app.showTitle();
  }
  app.start();
}

boot().catch((err: unknown) => {
  console.error(err);
  const pre = document.createElement('pre');
  pre.style.cssText =
    'position:fixed;inset:0;padding:2em;color:#f88;background:#100;white-space:pre-wrap;font:14px monospace;z-index:9';
  pre.textContent =
    err instanceof ContentError
      ? err.message
      : `Failed to start:\n${err instanceof Error ? (err.stack ?? err.message) : String(err)}`;
  document.body.append(pre);
});
