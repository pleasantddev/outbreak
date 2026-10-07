// Multiplayer: quick match, create and join rooms by code, the room lobby with host controls and quick chat,
// matchmaking, friends and leaderboards. Rooms are instanced races; the map is content, the race is the session.
import type { App, Screen } from '../../app/app';
import { el, acts, esc, laps } from '../dom';
import { topbar } from './main';
import { seg, MODES, TIMES, WEATHERS } from './raceflow';
import { CHAT_PHRASES, DEFAULT_ROOM, normaliseCode, type RoomConfig } from '../../shared/protocol';
import { AI_LEVELS, type AiLevel } from '../../shared/ai';
import { carById } from '../../shared/cars';
import { UI_ICON } from '../icons';
import { friendCode, saveProfile } from '../../app/profile';
import { fmtTime } from '../hud';
import { garageScreen } from './garage';
import { mainMenu } from './main';
import { settleRace, rewardPanel, ordinal } from './raceflow';

function statusLine(app: App) {
  const n = app.net;
  if (n.status === 'online') return `<span class="pill ok">ONLINE</span> <span class="small mute">${n.online.players} racing in ${n.online.rooms} rooms . ${n.rtt ? `${n.rtt} ms` : ''}</span>`;
  if (n.status === 'connecting') return '<span class="pill wait">CONNECTING</span>';
  return `<span class="pill">OFFLINE</span> <span class="small mute">${esc(n.lastError || 'Not connected')}</span>`;
}

/** Keep a screen in sync with the network: re-render when room state changes. */
function live(app: App, screen: Screen, follow?: () => void): Screen {
  // refresh() swaps screens without onLeave, so a replaced screen drops its own subscription
  const off = app.net.onChange(() => {
    if (app.top?.screen !== screen && !screen.el.isConnected) { off(); return; }
    follow?.(); if (app.top?.screen === screen) app.refresh();
  });
  const prevLeave = screen.onLeave;
  screen.onLeave = () => { off(); prevLeave?.(); };
  return screen;
}

export function multiplayer(app: App): Screen {
  app.net.ensure();
  const p = app.profile;
  const node = el(`<div class="screen">
    ${topbar('Multiplayer', 'Instanced races for up to 12 cars', app)}
    <div class="row" style="margin-bottom:12px">${statusLine(app)}</div>
    <div class="split">
      <div class="scroll" style="display:flex; flex-direction:column; gap:10px">
        <button class="card" data-act="quick" data-autofocus><div class="k">Quick match</div><div class="d">Jump into the next public race. Empty seats fill with AI.</div></button>
        <button class="card" data-act="create"><div class="k">Create room</div><div class="d">Pick the route and the rules, then send your crew the code.</div></button>
        <button class="card" data-act="join"><div class="k">Join with a code</div><div class="d">Got a LAGOS code or an invite link? Enter it here.</div></button>
        <button class="card" data-act="friends"><div class="k">Friends</div><div class="d">Your friend code and the people you raced recently.</div></button>
        <button class="card" data-act="boards"><div class="k">Leaderboards</div><div class="d">Lap records on every route.</div></button>
      </div>
      <div class="scroll panel" style="padding:16px; display:flex; flex-direction:column; gap:10px">
        <div class="h3">How rooms work</div>
        <div class="small mute" style="line-height:1.5">Every race is its own room of up to 12 cars. The host sets the route, laps, AI, weather and rules; nobody can change results, physics or rewards. Drop out mid race and an AI keeps your car going until you reconnect. A party is simply a private room: create one and share the link.</div>
        <div class="h3" style="margin-top:6px">Recent racers</div>
        ${p.recent.length ? p.recent.slice(0, 8).map((r) => `<div class="player-row"><div class="n">${esc(r.name)}</div><span class="small mute">${new Date(r.at).toLocaleDateString()}</span></div>`).join('') : '<div class="mute small">Race online and the people you meet show up here.</div>'}
      </div>
    </div>
  </div>`);
  acts(node, {
    back: () => app.back(),
    quick: () => { app.net.quickMatch(); app.go(matchmaking); },
    create: () => app.go(createRoom),
    join: () => app.go(joinRoom),
    friends: () => app.go(friendsScreen),
    boards: () => app.go(leaderboards),
  });
  return live(app, { el: node, view: 'city' });
}

export function matchmaking(app: App): Screen {
  const room = app.net.room;
  const node = el(`<div class="screen">
    ${topbar('Quick match')}
    <div class="searching">
      <div class="spinner"></div>
      <div class="h2">${room ? 'Race found' : 'Finding a race'}</div>
      <div class="mute">${room ? `${room.players.length} in the room . ${esc(room.config.track)}` : app.net.status === 'online' ? 'Looking for an open room in Oshodi' : 'Connecting to the race server'}</div>
      <button class="btn ghost" data-act="cancel"><span>Cancel</span></button>
    </div>
  </div>`);
  acts(node, { back: () => { app.net.leave(); app.back(); }, cancel: () => { app.net.leave(); app.back(); } });
  const screen = live(app, { el: node, view: 'city' }, () => { if (app.net.room && app.top?.screen === screen) { app.back(); app.show(lobby); } });
  return screen;
}

let draft: RoomConfig = { ...DEFAULT_ROOM };
function configForm(app: App, c: RoomConfig) {
  const tracks = app.stage!.tracks;
  return `
    <div class="field"><span class="lab">Route</span><div class="seg">${tracks.map((t) => `<button class="${t.id === c.track ? 'on' : ''}" data-act="cfg" data-k="track" data-v="${t.id}">${esc(t.name)}</button>`).join('')}</div></div>
    ${seg('Mode', MODES.filter((m) => m.id !== 'trial').map((m) => [m.id, m.name] as [string, string]), c.mode).replace(/data-act="seg"/g, 'data-act="cfg"').replace(/data-k="Mode"/g, 'data-k="mode"')}
    ${seg('Laps', [1, 2, 3, 4, 5].map((n) => [n, String(n)] as [number, string]), c.laps).replace(/data-act="seg"/g, 'data-act="cfg"').replace(/data-k="Laps"/g, 'data-k="laps"')}
    ${seg('AI racers', [0, 3, 5, 7, 11].map((n) => [n, String(n)] as [number, string]), c.aiFill).replace(/data-act="seg"/g, 'data-act="cfg"').replace(/data-k="AI racers"/g, 'data-k="aiFill"')}
    ${seg('AI level', (Object.keys(AI_LEVELS) as AiLevel[]).map((k) => [k, AI_LEVELS[k].label] as [string, string]), c.aiLevel).replace(/data-act="seg"/g, 'data-act="cfg"').replace(/data-k="AI level"/g, 'data-k="aiLevel"')}
    ${seg('Traffic', [[0, 'Off'], [1, 'Light'], [2, 'Rush hour'], [3, 'Go slow']] as [number, string][], c.traffic).replace(/data-act="seg"/g, 'data-act="cfg"').replace(/data-k="Traffic"/g, 'data-k="traffic"')}
    ${seg('Time', TIMES, c.time).replace(/data-act="seg"/g, 'data-act="cfg"').replace(/data-k="Time"/g, 'data-k="time"')}
    ${seg('Weather', WEATHERS, c.weather).replace(/data-act="seg"/g, 'data-act="cfg"').replace(/data-k="Weather"/g, 'data-k="weather"')}
    ${seg('Cars', [['any', 'Any'], ['street', 'Street'], ['sport', 'Sport'], ['super', 'Super'], ['heavy', 'Heavy']] as [string, string][], c.carClass).replace(/data-act="seg"/g, 'data-act="cfg"').replace(/data-k="Cars"/g, 'data-k="carClass"')}
    ${seg('Players', [2, 4, 6, 8, 12].map((n) => [n, String(n)] as [number, string]), c.maxPlayers).replace(/data-act="seg"/g, 'data-act="cfg"').replace(/data-k="Players"/g, 'data-k="maxPlayers"')}
    ${seg('Races', [1, 3, 5].map((n) => [n, String(n)] as [number, string]), c.races).replace(/data-act="seg"/g, 'data-act="cfg"').replace(/data-k="Races"/g, 'data-k="races"')}
    <div class="toggle"><div class="t">Public room<small>Anyone in quick match can join</small></div><button class="switch ${c.isPublic ? 'on' : ''}" data-act="cfgPublic" role="switch" aria-checked="${c.isPublic}" aria-label="Public"></button></div>`;
}
function applyCfg(c: RoomConfig, k: string, v: string): Partial<RoomConfig> {
  const num = ['laps', 'aiFill', 'traffic', 'maxPlayers', 'races'];
  return { [k]: num.includes(k) ? +v : v } as Partial<RoomConfig>;
}

export function createRoom(app: App): Screen {
  app.net.ensure();
  const node = el(`<div class="screen">
    ${topbar('Create room', 'You are the host. Set the race up.')}
    <div class="scroll panel" style="padding:16px; display:flex; flex-direction:column; gap:12px; flex:1; max-width:880px">${configForm(app, draft)}</div>
    <div class="bottombar"><span class="small mute">${statusLine(app)}</span><button class="btn" data-act="create" data-autofocus><span>Create room</span></button></div>
  </div>`);
  acts(node, {
    back: () => app.back(),
    cfg: (t) => { draft = { ...draft, ...applyCfg(draft, t.dataset.k!, t.dataset.v!) }; app.refresh(); },
    cfgPublic: () => { draft.isPublic = !draft.isPublic; app.refresh(); },
    create: () => { app.net.createRoom(draft); },
  });
  const screen = live(app, { el: node, view: 'city' }, () => { if (app.net.room && app.top?.screen === screen) { app.back(); app.show(lobby); } });
  return screen;
}

export function joinRoom(app: App): Screen {
  app.net.ensure();
  const node = el(`<div class="screen">
    ${topbar('Join a room')}
    <div class="panel" style="padding:20px; display:flex; flex-direction:column; gap:14px; max-width:520px">
      <div class="field"><label for="code">Room code</label><input id="code" class="input code" placeholder="LAGOS-0000" maxlength="11" inputmode="numeric" data-autofocus></div>
      <div class="small mute">Codes look like LAGOS-4827. The four digits are enough.</div>
      <button class="btn" data-act="join"><span>Join</span></button>
      <div class="small">${statusLine(app)}</div>
    </div>
  </div>`);
  const input = node.querySelector('input') as HTMLInputElement;
  const go = () => { const code = normaliseCode(input.value); if (!code) { app.toast('Enter the four digits of the code'); return; } app.net.joinRoom(code); };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  acts(node, { back: () => app.back(), join: go });
  const screen = live(app, { el: node, view: 'city' }, () => { if (app.net.room && app.top?.screen === screen) { app.back(); app.show(lobby); } });
  return screen;
}

export function lobby(app: App): Screen {
  const room = app.net.room;
  if (!room) {
    const node = el(`<div class="screen">${topbar('Room')}<div class="searching"><div class="mute">You are not in a room.</div><button class="btn" data-act="back"><span>Back</span></button></div></div>`);
    acts(node, { back: () => app.back() });
    return { el: node, view: 'city' };
  }
  const me = room.players.find((p) => p.id === app.net.you);
  const host = room.host === app.net.you;
  const td = app.stage!.tracks.find((t) => t.id === room.config.track);
  const startsIn = room.startsIn !== null ? Math.ceil(room.startsIn / 1000) : null;
  const node = el(`<div class="screen">
    ${topbar(room.quick ? 'Quick match room' : 'Room lobby', `${room.players.length}/${room.config.maxPlayers} players . race ${room.raceNo + (room.phase === 'waiting' ? 1 : 0)} of ${room.config.races}`)}
    <div class="split">
      <div class="scroll" style="display:flex; flex-direction:column; gap:10px">
        <div class="panel" style="padding:14px">
          <div class="small mute">ROOM CODE</div>
          <div class="row"><div class="lobby-code">${room.code}</div><span class="spacer"></span>
            <button class="icon-btn" data-act="copy" aria-label="Copy invite link">${UI_ICON.copy}</button>
            <button class="icon-btn" data-act="share" aria-label="Share">${UI_ICON.share}</button></div>
          <div class="small mute">${room.config.isPublic ? 'Public room' : 'Private room: only people with the code can join'}</div>
        </div>
        ${room.players.map((p) => `<div class="player-row">
          <div class="avatar" style="background:${p.card.color}; width:38px; height:38px; font-size:1em">${esc(p.card.name.slice(0, 2).toUpperCase())}</div>
          <div style="flex:1; min-width:0"><div class="n">${esc(p.card.name)} ${p.host ? `<span class="pill host">HOST</span>` : ''}</div><div class="car">${esc(carById(p.card.carId).name)} . ${esc(p.card.crew)} . LVL ${p.card.level}${room.raceNo ? ` . ${p.points} pts` : ''}</div></div>
          ${!p.connected ? '<span class="pill wait">AWAY</span>' : p.spectating ? '<span class="pill wait">WATCHING</span>' : p.ready ? '<span class="pill ok">READY</span>' : '<span class="pill wait">NOT READY</span>'}
          ${host && p.id !== app.net.you ? `<button class="btn ghost small" data-act="kick" data-id="${p.id}"><span>Kick</span></button>` : ''}
        </div>`).join('')}
        ${room.config.aiFill ? `<div class="small mute">Up to ${room.config.aiFill} AI racers (${AI_LEVELS[room.config.aiLevel].label}) fill the empty grid slots.</div>` : ''}
      </div>
      <div class="scroll panel" style="padding:16px; display:flex; flex-direction:column; gap:12px">
        <div class="row"><div class="h3">${esc(td?.name ?? room.config.track)}</div><span class="spacer"></span>${host && room.phase === 'waiting' ? '<button class="btn ghost small" data-act="edit"><span>Race settings</span></button>' : ''}</div>
        <div class="row" style="flex-wrap:wrap; gap:6px"><span class="tag dark">${room.config.mode.toUpperCase()}</span><span class="tag dark">${laps(room.config.laps)}</span><span class="tag dark">${room.config.time.toUpperCase()}</span><span class="tag dark">${room.config.weather.toUpperCase()}</span><span class="tag dark">${room.config.carClass === 'any' ? 'ANY CAR' : room.config.carClass.toUpperCase() + ' CARS'}</span></div>
        ${room.lastResults ? `<div><div class="h3" style="margin-bottom:4px">Last race</div><table class="list"><tbody>${room.lastResults.slice(0, 6).map((r) => `<tr class="${r.id === app.net.you ? 'me' : ''}"><td>${r.place}</td><td>${esc(r.name)}</td><td class="mono">${r.time ? fmtTime(r.time) : 'DNF'}</td><td>+${r.points}</td></tr>`).join('')}</tbody></table></div>` : ''}
        <div class="h3">Quick chat</div>
        <div class="chat">${app.net.chat.slice(-6).map((c) => `<div class="m"><b>${esc(c.name)}</b>${esc(CHAT_PHRASES[c.phrase] ?? '')}</div>`).join('') || '<div class="mute small">Say hello.</div>'}</div>
        <div class="quick-chat">${CHAT_PHRASES.map((ph, i) => `<button class="btn ghost small" data-act="say" data-v="${i}"><span>${esc(ph)}</span></button>`).join('')}</div>
        <div class="bottombar" style="margin-top:auto">
          ${startsIn !== null ? `<span class="tag pink">${room.phase === 'countdown' ? 'STARTING' : 'STARTS IN'} ${startsIn}s</span>` : ''}
          <button class="btn ghost small" data-act="car"><span>Change car</span></button>
          ${room.phase === 'waiting' ? `<button class="btn ${me?.ready ? 'ghost' : ''}" data-act="ready" data-autofocus><span>${me?.ready ? 'Not ready' : 'Ready'}</span></button>` : `<span class="tag">${room.phase.toUpperCase()}</span>`}
          ${host && room.phase === 'waiting' ? '<button class="btn pink" data-act="start"><span>Start now</span></button>' : ''}
        </div>
      </div>
    </div>
  </div>`);
  const link = app.net.inviteLink(room.code);
  acts(node, {
    back: () => { app.net.leave(); app.back(); },
    copy: () => { void navigator.clipboard?.writeText(link).then(() => app.toast('Invite link copied')).catch(() => app.toast(link)); },
    share: () => { if (navigator.share) void navigator.share({ title: 'Lagos Rush', text: `Race me in Oshodi. Room ${room.code}`, url: link }).catch(() => {}); else void navigator.clipboard?.writeText(link).then(() => app.toast('Invite link copied')); },
    ready: () => app.net.ready(!me?.ready),
    start: () => app.net.start(),
    kick: (t) => app.net.kick(t.dataset.id!),
    say: (t) => app.net.say(+t.dataset.v!),
    car: () => app.go(garageScreen),
    edit: () => {
      let c = { ...room.config };
      app.modal(`<div class="h2">Race settings</div><div class="scroll" style="display:flex; flex-direction:column; gap:10px; max-height:60vh">${configForm(app, c)}</div><div class="bottombar"><button class="btn ghost small" data-act="close"><span>Cancel</span></button><button class="btn" data-act="save"><span>Save</span></button></div>`, (m, close) => {
        const rerender = () => { (m.querySelector('.scroll') as HTMLElement).innerHTML = configForm(app, c); };
        acts(m, {
          cfg: (t) => { c = { ...c, ...applyCfg(c, t.dataset.k!, t.dataset.v!) }; rerender(); },
          cfgPublic: () => { c.isPublic = !c.isPublic; rerender(); },
          close: () => close(),
          save: () => { app.net.config(c); close(); },
        });
      });
    },
  });
  // keep the room countdown ticking on screen
  let tick = 0;
  return live(app, { el: node, view: 'city', onFrame: (dt) => { tick += dt; if (tick > 1 && app.net.room?.startsIn) { tick = 0; app.refresh(); } } });
}

export function friendsScreen(app: App): Screen {
  const p = app.profile;
  const node = el(`<div class="screen">
    ${topbar('Friends')}
    <div class="split">
      <div class="panel" style="padding:16px; display:flex; flex-direction:column; gap:12px">
        <div class="field"><span class="lab">Your friend code</span><div class="row"><span class="h2 mono" style="letter-spacing:.04em">${friendCode(p)}</span><span class="spacer"></span><button class="icon-btn" data-act="copy" aria-label="Copy">${UI_ICON.copy}</button></div></div>
        <div class="field"><label for="fc">Add a friend</label><div class="row"><input id="fc" class="input" placeholder="RUSH-XXXX-XXXX" style="flex:1; text-transform:uppercase"><button class="btn small" data-act="add"><span>Add</span></button></div></div>
        <div class="small mute">To race together, create a private room and send the invite link. Friends you add here are saved on this device.</div>
        ${app.net.room ? `<button class="btn" data-act="invite"><span>Copy link to room ${app.net.room.code}</span></button>` : ''}
      </div>
      <div class="scroll" style="display:flex; flex-direction:column; gap:8px">
        <div class="h3">Friends</div>
        ${p.friends.length ? p.friends.map((f, i) => `<div class="player-row"><div class="n">${esc(f.name)}</div><span class="small mute mono">${esc(f.code)}</span><button class="btn ghost small" data-act="remove" data-v="${i}"><span>Remove</span></button></div>`).join('') : '<div class="mute small">No friends added yet.</div>'}
        <div class="h3" style="margin-top:8px">Raced recently</div>
        ${p.recent.length ? p.recent.slice(0, 12).map((r) => `<div class="player-row"><div class="n">${esc(r.name)}</div><span class="small mute">${esc(r.crew ?? '')}</span></div>`).join('') : '<div class="mute small">Nobody yet.</div>'}
      </div>
    </div>
  </div>`);
  acts(node, {
    back: () => app.back(),
    copy: () => { void navigator.clipboard?.writeText(friendCode(p)).then(() => app.toast('Copied')); },
    add: () => {
      const v = (node.querySelector('#fc') as HTMLInputElement).value.toUpperCase().trim();
      if (!/^RUSH-[0-9A-F]{4}-[0-9A-F]{4}$/.test(v)) { app.toast('Friend codes look like RUSH-1A2B-3C4D'); return; }
      if (v === friendCode(p)) { app.toast('That one is you'); return; }
      if (!p.friends.some((f) => f.code === v)) p.friends.push({ name: `Friend ${p.friends.length + 1}`, id: v, code: v });
      saveProfile(p); app.refresh();
    },
    remove: (t) => { p.friends.splice(+t.dataset.v!, 1); saveProfile(p); app.refresh(); },
    invite: () => { const link = app.net.inviteLink(app.net.room!.code); void navigator.clipboard?.writeText(link).then(() => app.toast('Invite link copied')); },
  });
  return { el: node, view: 'city' };
}

export function leaderboards(app: App): Screen {
  const p = app.profile;
  const node = el(`<div class="screen">
    ${topbar('Leaderboards', 'Lap records on every route')}
    <div class="scroll panel" style="padding:16px; max-width:820px">
      <table class="list"><thead><tr><th>Route</th><th>Par</th><th>Your best</th><th></th></tr></thead><tbody>
        ${app.stage!.tracks.map((t) => { const b = p.records[t.id]; return `<tr><td>${esc(t.name)}</td><td class="mono">${fmtTime(t.par)}</td><td class="mono">${b ? fmtTime(b) : '-'}</td><td>${b && b <= t.par ? '<span class="tag">GOLD</span>' : b && b <= t.par * 1.1 ? '<span class="tag dark">SILVER</span>' : b ? '<span class="tag dark">BRONZE</span>' : ''}</td></tr>`; }).join('')}
      </tbody></table>
      <div class="small mute" style="margin-top:12px">Gold is the par time for the route. Online leaderboards arrive with the regional servers; for now records live on this device.</div>
    </div>
  </div>`);
  acts(node, { back: () => app.back() });
  return { el: node, view: 'city' };
}

/** Back to the room after a race, with a sensible back stack under it. */
export function toLobby(app: App) {
  app.leaveRace();
  app.show(mainMenu, true);
  app.show(multiplayer);
  app.show(app.net.room ? lobby : multiplayer);
}

export function onlineResults(app: App): Screen {
  const r = app.lastResult!;
  const rows = app.net.results ?? [];
  const room = app.net.room;
  const td = app.stage!.tracks.find((t) => t.id === r.trackId)!;
  const me = r.standings.find((x) => x.idx === r.playerIdx)!;
  const { reward, levelUp, newRecord } = settleRace(app, r, true);
  const lead = rows.find((x) => x.time !== null);
  const table = rows.map((x) => `<tr class="${x.id === app.net.you ? 'me' : ''}"><td>${x.place}</td><td>${esc(x.name)}${x.human ? '' : ' <span class="tag dark">AI</span>'}</td><td class="hide-sm">${esc(carById(x.carId).name)}</td><td class="mono">${x.time === null ? 'DNF' : x === lead ? fmtTime(x.time) : `+${(x.time - (lead?.time ?? 0)).toFixed(3)}`}</td><td class="mono">${x.bestLap ? fmtTime(x.bestLap) : '-'}</td><td class="mono">+${x.points}</td></tr>`).join('');
  const series = room ? [...room.players].sort((a, b) => b.points - a.points) : [];
  const nextIn = room && room.phase === 'results' ? 'The room opens for the next race in a few seconds.' : room && room.phase === 'waiting' ? 'The room is open. Ready up for the next one.' : '';
  const node = el(`<div class="screen results">
    <div class="split results-split">
      <div class="scroll" style="display:flex; flex-direction:column; gap:14px">
        <div><span class="tag">${esc(td.name)}</span> <span class="tag dark">ONLINE ${esc(r.cfg.mode.toUpperCase())}</span>${room ? ` <span class="tag dark">${room.code}</span>` : ''}</div>
        <div class="podium-place">${me.finished ? ordinal(me.place) : 'DNF'}</div>
        <div class="h3">${me.place === 1 ? 'You took Oshodi. Everybody saw it.' : me.place <= 3 ? 'Podium. Run it back and take the top step.' : 'The room is waiting for a rematch.'}</div>
        <div class="panel" style="padding:12px 14px">
          <table class="list"><thead><tr><th>#</th><th>Driver</th><th class="hide-sm">Car</th><th>Time</th><th>Best</th><th>Pts</th></tr></thead><tbody>${table}</tbody></table>
        </div>
      </div>
      <div class="scroll" style="display:flex; flex-direction:column; gap:12px; justify-self:end; width:min(420px,100%)">
        ${room ? `<div class="panel" style="padding:14px">
          <div class="row"><div class="h3">${room.seriesOver ? 'Series final' : 'Series'}</div><span class="spacer"></span><span class="small mute">race ${room.raceNo} of ${room.config.races}</span></div>
          ${room.seriesOver && series[0] ? `<div class="tag pink" style="margin:6px 0">WINNER: ${esc(series[0].card.name)}</div>` : ''}
          ${series.map((p, i) => `<div class="reward-line"><span>${i + 1}. ${esc(p.card.name)}${p.id === app.net.you ? ' (you)' : ''}</span><span class="mono">${p.points} pts</span></div>`).join('')}
        </div>` : ''}
        ${rewardPanel(app, reward, levelUp, newRecord, r.bestLap)}
        ${nextIn ? `<div class="small mute">${nextIn}</div>` : ''}
        <button class="btn" data-act="lobby" data-autofocus><span>${room ? 'Back to the room' : 'Multiplayer'}</span></button>
        <button class="btn ghost" data-act="leave"><span>Leave room</span></button>
      </div>
    </div>
  </div>`);
  acts(node, {
    lobby: () => toLobby(app),
    leave: () => app.leaveOnline(),
  });
  app.audio.music_('results', 0);
  return live(app, { el: node, onBack: () => { toLobby(app); return false; } });
}
