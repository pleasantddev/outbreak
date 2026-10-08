// Page routes: the race game, the race designer and a designer test drive. A normal page carries them in the
// query string (?dev=designer&design=<id>, ?test=<id>). A hosted preview page passes only a bare hash through, so
// the same routes also read from #designer, #designer.<id> and #test.<id>, and builds made for such a page move
// between routes by hash.

/** A build made to run where no room server exists, such as a hosted preview page, plays offline only. */
export const OFFLINE = import.meta.env.VITE_OFFLINE === '1';

export function routeParams(): URLSearchParams {
  const q = new URLSearchParams(location.search);
  const m = /^(designer|test)(?:\.([a-z0-9-]{1,40}))?$/.exec(location.hash.slice(1));
  if (m?.[1] === 'designer') { q.set('dev', 'designer'); if (m[2]) q.set('design', m[2]); }
  else if (m?.[1] === 'test' && m[2]) q.set('test', m[2]);
  return q;
}

/** Open another route. The game and the designer are separate pages, so this always reloads. */
export function goRoute(to: 'game' | 'designer' | 'test', id?: string) {
  if (OFFLINE) {
    location.hash = to === 'game' ? '' : id ? `${to}.${id}` : to;
    location.reload();
    return;
  }
  location.href = to === 'game' ? '/' : to === 'designer' ? `/?dev=designer${id ? `&design=${encodeURIComponent(id)}` : ''}` : `/?test=${encodeURIComponent(id ?? '')}`;
}
