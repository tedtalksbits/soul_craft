/** Shared between the Vite dev plugin (vite.config.ts) and the running game. */

/** HMR custom event fired when a file under /content or /assets changes. */
export const FILE_CHANGED_EVENT = 'soul-craft:file-changed';
export interface FileChangedPayload {
  /** Root-relative path, e.g. `/content/enemies.json`. */
  path: string;
  type: 'create' | 'update' | 'delete';
}

/** POST `{ path, data }` here to write `content/<path>` (dev server only). */
export const CONTENT_WRITE_ENDPOINT = '/__dev/content';
