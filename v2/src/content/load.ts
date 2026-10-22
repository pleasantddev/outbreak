// Loads a content file (served next to the game, or from the server when online).
import type { ContentFile } from './schema';
let base = 'content/';
export function setContentBase(url: string) { base = url.endsWith('/') ? url : url + '/'; }
export async function loadContent<T>(kind: string): Promise<T[]> {
  try { const r = await fetch(`${base}${kind}.json`); if (!r.ok) return []; const j = (await r.json()) as ContentFile<T>; return j.items ?? []; }
  catch { return []; }
}
