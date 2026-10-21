// Front end after loading: profile creation (first launch only) and the 3D lobby (every launch after).
// Console style: your hustler idles on a lit plinth in the middle of Oshodi, menu on the left, PLAY bottom right.
// Keyboard, gamepad and touch all drive the same state. The 3D side is render/lobbyScene.ts.
import * as THREE from 'three';
import type { LobbyStage } from '../render/lobbyScene';
import { ROSTER, ROSTER_IDS, type RosterId } from '../render/humans';
import { OUTFITS, SKIN_NAMES, NAME_MAX, customisable, levelProgress, lookFor, shortId, validateName, type Profile, type ProfileDraft, type ProfileStore } from '../profile';
import { SKIN_TONES, type CharacterLook } from '../data/cosmetics';
import { audio } from '../audio/audio';

const svg = (d: string, sw = 2) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;
const IC = {
  play: 'M7 4.5v15l12-7.5z', person: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20c1.4-3.6 4.2-5.5 7.5-5.5s6.1 1.9 7.5 5.5',
  car: 'M5 16h14M5 16v3h3v-3m8 0v3h3v-3M3 16v-4l2-5h14l2 5v4M7 12h.01M17 12h.01', land: 'M3 20h18M5 20V10l7-5 7 5v10M10 20v-5h4v5',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12l2-1-1-3-2 .2-1.3-1.3.2-2-3-1-1 2h-1.8l-1-2-3 1 .2 2L6 7.2 4 7l-1 3 2 1v1.8l-2 1 1 3 2-.2 1.3 1.3-.2 2 3 1 1-2h1.8l1 2 3-1-.2-2 1.3-1.3 2 .2 1-3-2-1z',
  left: 'M15 5l-7 7 7 7', right: 'M9 5l7 7-7 7', wallet: 'M3 7h15a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7zm0 0 12-3v3M16 13.5h2', bank: 'M3 10h18M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18M12 3 3 8h18z',
  dice: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM8 8h.01M16 8h.01M12 12h.01M8 16h.01M16 16h.01', lock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3', check: 'M5 12.5l4.5 4.5L19 7',
};

const CSS = `
#fe{position:fixed;inset:0;z-index:12;font-family:Inter,system-ui,-apple-system,sans-serif;color:#f3f5f8;-webkit-font-smoothing:antialiased;user-select:none;-webkit-user-select:none;overflow:hidden;--teal:#2de0c8;--pur:#8b5cf6;--pur2:#6d3ef0;--mut:#9ba3b4;--line:rgba(255,255,255,.1);--glass:rgba(10,12,20,.6);--safe-l:max(18px,env(safe-area-inset-left));--safe-r:max(18px,env(safe-area-inset-right));--safe-t:max(12px,env(safe-area-inset-top));--safe-b:max(14px,env(safe-area-inset-bottom))}
#fe *{box-sizing:border-box}
#fe button{font-family:inherit;color:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent;touch-action:manipulation}
#fe .catch{position:absolute;inset:0;touch-action:none;cursor:grab}
#fe .catch:active{cursor:grabbing}
#fe .vig{position:absolute;inset:0;pointer-events:none;background:linear-gradient(90deg,rgba(4,5,9,.62),rgba(4,5,9,0) 34%),linear-gradient(0deg,rgba(4,5,9,.7),rgba(4,5,9,0) 30%),linear-gradient(180deg,rgba(4,5,9,.55),rgba(4,5,9,0) 20%)}
#fe .gl{background:var(--glass);border:1px solid var(--line);backdrop-filter:blur(16px) saturate(140%);-webkit-backdrop-filter:blur(16px) saturate(140%);box-shadow:0 10px 30px rgba(0,0,0,.35)}
#fe .disp{font-family:Oswald,Impact,'Arial Narrow',sans-serif;font-weight:700;text-transform:uppercase;letter-spacing:.06em}
#fe .num{font-family:Teko,Oswald,sans-serif;font-weight:600;letter-spacing:.03em}
#fe .lbl{font-family:Oswald,sans-serif;font-weight:600;font-size:11.5px;letter-spacing:.24em;text-transform:uppercase;color:var(--teal)}
/* top bar */
#fe .top{position:absolute;left:var(--safe-l);right:var(--safe-r);top:var(--safe-t);display:flex;align-items:center;gap:10px;pointer-events:none}
#fe .top>*{pointer-events:auto}
#fe .me{display:flex;align-items:center;gap:12px;padding:6px 18px 6px 6px;border-radius:16px;text-align:left;border:1px solid var(--line);position:relative;overflow:hidden}
#fe .me .av{width:48px;height:48px;border-radius:13px;background:linear-gradient(140deg,var(--pur),var(--teal));display:flex;align-items:center;justify-content:center;font-size:21px;box-shadow:inset 0 0 0 1px rgba(255,255,255,.25)}
#fe .me .who{display:flex;flex-direction:column;gap:2px;min-width:0}
#fe .me .who b{font-size:20px;line-height:1;max-width:210px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#fe .me .who i{font-style:normal;font-size:11px;color:var(--mut);letter-spacing:.06em;font-weight:600}
#fe .me .xp{position:absolute;left:0;right:0;bottom:0;height:3px;background:rgba(255,255,255,.08)}
#fe .me .xp u{display:block;height:100%;background:linear-gradient(90deg,var(--teal),var(--pur))}
#fe .grow{flex:1}
#fe .brk{display:none}
#fe .pill{display:flex;align-items:center;gap:8px;height:40px;padding:0 16px 0 6px;border-radius:999px;font-size:24px}
#fe .pill .ico{width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#0b0d14}
#fe .pill .ico svg{width:16px;height:16px;stroke-width:2.2}
#fe .pill.cash .ico{background:#49e08a}#fe .pill.cash b{color:#c9f7da}#fe .pill.bank .ico{background:#4aa8ff}#fe .pill.bank b{color:#d4e8ff}
#fe .icon{width:44px;height:44px;border-radius:14px;display:flex;align-items:center;justify-content:center;border:1px solid var(--line)}
#fe .icon svg{width:22px;height:22px}
/* menu */
#fe .menu{position:absolute;left:var(--safe-l);top:calc(var(--safe-t) + 84px);display:flex;flex-direction:column;gap:6px}
#fe .mi{position:relative;isolation:isolate;display:flex;align-items:center;gap:14px;border:none;background:none;padding:11px 34px 11px 16px;font-size:27px;line-height:1;color:#c5cbd8;text-align:left;min-width:230px;transition:color .15s,transform .2s}
#fe .mi::before{content:'';position:absolute;inset:0;transform:skewX(-10deg);background:linear-gradient(90deg,rgba(10,12,20,.55),rgba(10,12,20,.15));border-left:3px solid transparent;border-radius:3px;transition:background .2s,border-color .2s,box-shadow .2s;z-index:-1}
#fe .mi svg{width:25px;height:25px;flex:0 0 auto;opacity:.85}
#fe .mi small{font-family:Inter,sans-serif;font-size:9.5px;font-weight:800;letter-spacing:.14em;color:#0b0d14;background:var(--teal);padding:2px 6px;border-radius:4px;margin-left:auto}
#fe .mi:hover{color:#fff;transform:translateX(4px)}
#fe .mi.sel{color:#fff}
#fe .mi.sel::before{background:linear-gradient(90deg,rgba(45,224,200,.28),rgba(139,92,246,.2));border-left-color:var(--teal);box-shadow:0 0 28px rgba(45,224,200,.18)}
#fe .mi.sel svg{color:var(--teal);opacity:1}
#fe .mi.focus::after{content:'';position:absolute;inset:-3px;transform:skewX(-10deg);border:2px solid rgba(255,255,255,.85);border-radius:5px;pointer-events:none}
/* play */
#fe .play{isolation:isolate;position:absolute;right:var(--safe-r);bottom:var(--safe-b);width:min(330px,42vw);height:88px;border:none;background:none;padding:0;color:#fff;transition:transform .15s}
#fe .play::before{content:'';position:absolute;inset:0;transform:skewX(-10deg);border-radius:6px;background:linear-gradient(100deg,#19c9b1,#6d3ef0 80%);box-shadow:0 14px 40px rgba(109,62,240,.5),0 0 0 1px rgba(255,255,255,.28) inset;overflow:hidden}
#fe .play::after{content:'';position:absolute;top:0;bottom:0;width:28%;left:-40%;transform:skewX(-10deg);background:linear-gradient(90deg,transparent,rgba(255,255,255,.4),transparent);animation:fe-shine 3.6s ease-in-out infinite;border-radius:6px;pointer-events:none}
@keyframes fe-shine{0%,55%{left:-40%}100%{left:130%}}
#fe .play span{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:2px}
#fe .play b{font-size:46px;line-height:.9;letter-spacing:.1em;text-shadow:0 3px 0 rgba(0,0,0,.28)}
#fe .play small{font-size:11.5px;font-weight:700;letter-spacing:.3em;text-transform:uppercase;color:rgba(255,255,255,.82)}
#fe .play:hover{transform:translateY(-2px)}
#fe .play:active{transform:scale(.98)}
#fe .play.focus::after{box-shadow:0 0 0 3px #fff}
/* news */
#fe .news{position:absolute;left:var(--safe-l);bottom:var(--safe-b);display:flex;gap:10px;max-width:calc(100% - 420px - var(--safe-l));pointer-events:none}
#fe .tile{pointer-events:auto;position:relative;width:216px;height:88px;border-radius:14px;padding:11px 13px;overflow:hidden;text-align:left;transition:transform .2s,border-color .2s;flex:0 0 auto}
#fe .tile::before{content:'';position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--c,var(--teal))}
#fe .tile em{display:block;font-style:normal;font-family:Oswald,sans-serif;font-weight:700;font-size:10.5px;letter-spacing:.22em;color:var(--c,var(--teal))}
#fe .tile b{display:block;font-size:14.5px;margin:3px 0 2px;line-height:1.15}
#fe .tile span{display:block;font-size:11.5px;line-height:1.3;color:#b5bccb;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
#fe .tile:hover{transform:translateY(-3px);border-color:rgba(255,255,255,.22)}
/* panels */
#fe .panel{position:absolute;right:var(--safe-r);top:calc(var(--safe-t) + 70px);bottom:calc(var(--safe-b) + 108px);width:min(372px,40vw);border-radius:22px;padding:18px 18px 16px;overflow:auto;overscroll-behavior:contain;animation:fe-in .35s cubic-bezier(.2,.9,.2,1);scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.2) transparent}
#fe .panel.tall{bottom:var(--safe-b);top:calc(var(--safe-t) + 70px)}
@keyframes fe-in{from{opacity:0;transform:translateX(26px)}to{opacity:1;transform:none}}
#fe .panel h2{margin:2px 0 4px;font-size:30px;line-height:1}
#fe .panel p{margin:0 0 12px;font-size:13px;line-height:1.45;color:#b9c0cf}
#fe .row{padding:11px 0 12px;border-top:1px solid var(--line);position:relative;border-radius:10px}
#fe .row:first-of-type{border-top:none}
#fe .row.focus{outline:2px solid rgba(255,255,255,.85);outline-offset:3px}
#fe .row>.lbl{display:block;margin-bottom:9px}
#fe .sub{font-size:12px;color:var(--mut);line-height:1.4}
/* customizer */
#fe .cz-model{display:flex;align-items:center;gap:10px}
#fe .arrow{flex:0 0 46px;height:46px;border-radius:50%;background:rgba(255,255,255,.07);border:1px solid var(--line);display:flex;align-items:center;justify-content:center;transition:background .15s,transform .15s}
#fe .arrow svg{width:22px;height:22px}
#fe .arrow:hover{background:rgba(45,224,200,.2)}
#fe .arrow:active{transform:scale(.9)}
#fe .cz-name{flex:1;text-align:center;min-width:0}
#fe .cz-name b{display:block;font-size:30px;line-height:1.05}
#fe .cz-name span{display:block;font-size:12px;color:#b9c0cf;line-height:1.35;margin-top:3px}
#fe .dots{display:flex;gap:7px;justify-content:center;margin-top:10px}
#fe .dots i{width:22px;height:4px;border-radius:2px;background:rgba(255,255,255,.18);transition:background .2s,width .2s}
#fe .dots i.on{background:var(--teal);width:34px}
#fe .skins{display:flex;gap:9px;flex-wrap:wrap}
#fe .skin{width:40px;height:40px;border-radius:50%;border:2px solid rgba(255,255,255,.14);padding:0;position:relative;transition:transform .15s,border-color .15s}
#fe .skin:hover{transform:scale(1.08)}
#fe .skin.on{border-color:var(--teal);box-shadow:0 0 0 3px rgba(45,224,200,.25)}
#fe .skin.on::after{content:'';position:absolute;inset:11px;border-radius:50%;background:rgba(255,255,255,.9)}
#fe .outfits{display:grid;grid-template-columns:1fr 1fr;gap:8px}
#fe .of{display:flex;align-items:center;gap:9px;padding:8px 10px 8px 8px;border-radius:12px;background:rgba(255,255,255,.05);border:1px solid var(--line);text-align:left;transition:background .15s,border-color .15s}
#fe .of i{flex:0 0 28px;height:28px;border-radius:50%;box-shadow:inset 0 0 0 1px rgba(255,255,255,.25)}
#fe .of b{display:block;font-size:12.5px;line-height:1.1}
#fe .of span{display:block;font-size:10.5px;color:var(--mut);margin-top:1px}
#fe .of:hover{background:rgba(255,255,255,.1)}
#fe .of.on{border-color:var(--teal);background:rgba(45,224,200,.14)}
#fe .note{font-size:12px;color:var(--mut);padding:8px 10px;border-radius:10px;background:rgba(255,255,255,.04);line-height:1.4}
/* forms */
#fe .field{display:flex;gap:8px}
#fe .in{flex:1;min-width:0;height:48px;border-radius:12px;border:1.5px solid rgba(255,255,255,.16);background:rgba(0,0,0,.35);color:#fff;font:600 18px Inter,sans-serif;padding:0 14px;outline:none;transition:border-color .15s,box-shadow .15s;user-select:text;-webkit-user-select:text}
#fe .in::placeholder{color:#6f7788;font-weight:500}
#fe .in:focus{border-color:var(--teal);box-shadow:0 0 0 3px rgba(45,224,200,.2)}
#fe .in.bad{border-color:#ff4d5e;box-shadow:0 0 0 3px rgba(255,77,94,.18)}
#fe .err{min-height:18px;margin-top:6px;font-size:12px;font-weight:600;color:#ff8a94}
#fe .err.ok{color:#8ff0bd}
#fe .btn{height:48px;border:none;border-radius:12px;padding:0 18px;font-size:15px;letter-spacing:.12em;color:#fff;background:linear-gradient(180deg,var(--pur),var(--pur2));box-shadow:0 8px 20px rgba(109,62,240,.4),inset 0 1px 0 rgba(255,255,255,.25);transition:transform .12s,filter .15s,opacity .15s}
#fe .btn:hover{filter:brightness(1.12)}#fe .btn:active{transform:scale(.97)}
#fe .btn.ghost{background:rgba(255,255,255,.09);box-shadow:none}
#fe .btn.sq{flex:0 0 48px;padding:0;display:flex;align-items:center;justify-content:center}#fe .btn.sq svg{width:22px;height:22px}
#fe .btn[disabled]{opacity:.38;pointer-events:none;filter:grayscale(.6)}
#fe .ctaw{position:sticky;bottom:-17px;margin:0 -18px -16px;padding:14px 18px 14px;background:linear-gradient(0deg,rgba(10,12,20,.99) 80%,rgba(10,12,20,0))}#fe .ctaw .btn.cta:disabled{background:#262a3a;color:#6d7488;opacity:1}
#fe .cta{width:100%;height:60px;font-size:24px;letter-spacing:.14em;margin-top:6px;background:linear-gradient(100deg,#19c9b1,#6d3ef0 85%);box-shadow:0 12px 30px rgba(109,62,240,.45),inset 0 1px 0 rgba(255,255,255,.3)}
#fe .seg{display:flex;gap:6px}
#fe .seg button{flex:1;height:40px;border-radius:10px;border:1px solid var(--line);background:rgba(255,255,255,.05);font-size:13px;font-weight:700}
#fe .seg button.on{background:rgba(45,224,200,.2);border-color:var(--teal);color:#fff}
#fe input[type=range]{width:100%;accent-color:var(--teal);height:28px}
#fe .kv{display:flex;justify-content:space-between;gap:10px;font-size:13px;padding:3px 0;color:#b9c0cf}#fe .kv b{color:#fff;font-weight:600;text-align:right}
#fe .garage{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:10px 0}
#fe .slot{aspect-ratio:16/10;border-radius:14px;border:1.5px dashed rgba(255,255,255,.2);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;color:#8e96a8;font-size:11px;font-weight:600;letter-spacing:.08em}
#fe .slot svg{width:34px;height:34px;opacity:.55}
#fe .big{width:100%;height:56px;font-size:20px;letter-spacing:.14em}
/* name plate above the hero */
#fe .np{position:absolute;left:0;top:0;transform:translate(-50%,-100%);pointer-events:none;display:flex;flex-direction:column;align-items:center;gap:3px;white-space:nowrap;text-shadow:0 2px 10px rgba(0,0,0,.8)}
#fe .np b{font-size:25px;line-height:1;padding:5px 15px 4px;border-radius:7px;background:linear-gradient(100deg,rgba(10,12,20,.7),rgba(10,12,20,.5));border:1px solid rgba(255,255,255,.18);backdrop-filter:blur(8px)}
#fe .np i{font-style:normal;font-family:Teko,sans-serif;font-weight:600;font-size:16px;letter-spacing:.12em;color:var(--teal)}
#fe .hint{position:absolute;left:50%;top:calc(var(--safe-t) + 16px);transform:translateX(-50%);font-size:11px;font-weight:600;color:rgba(255,255,255,.5);letter-spacing:.06em;white-space:nowrap;pointer-events:none;display:flex;gap:16px}
#fe .hint kbd{font-family:Teko,sans-serif;font-size:14px;font-weight:600;background:rgba(255,255,255,.14);border-radius:5px;padding:0 6px;margin-right:5px;color:#fff;letter-spacing:.04em}
#fe .tapnote{position:absolute;left:50%;transform:translateX(-50%);bottom:calc(var(--safe-b) + 108px);font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:rgba(255,255,255,.4);pointer-events:none;font-weight:600}
/* onboarding */
#fe.onb .panel{width:min(400px,42vw);bottom:var(--safe-b);top:var(--safe-t)}
#fe .onb-h{font-size:36px;line-height:.98;margin:0 0 6px}
#fe .onb-h em{font-style:normal;background:linear-gradient(100deg,var(--teal),var(--pur));-webkit-background-clip:text;background-clip:text;color:transparent}
#fe .brandmark{position:absolute;left:var(--safe-l);top:var(--safe-t);font-size:23px;letter-spacing:.14em;color:#fff;text-shadow:0 2px 12px rgba(0,0,0,.7)}
#fe .brandmark em{font-style:normal;color:var(--teal)}
/* fades */
#fe-fade{position:fixed;inset:0;z-index:30;background:#000;opacity:0;pointer-events:none;transition:opacity .6s ease}
#fe-fade.on{opacity:1;pointer-events:auto}
#fe .intro{animation:fe-up .7s .1s cubic-bezier(.2,.9,.2,1) both}
@keyframes fe-up{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
/* ---- compact landscape (phones turned sideways) ---- */
@media (max-height:520px) and (orientation:landscape){
  #fe .top{gap:7px}#fe .me{padding:4px 12px 4px 4px;border-radius:12px;gap:9px}#fe .me .av{width:36px;height:36px;font-size:16px;border-radius:10px}#fe .me .who b{font-size:16px;max-width:140px}#fe .me .who i{font-size:9.5px}
  #fe .pill{height:32px;font-size:20px;padding-right:12px}#fe .pill .ico{width:22px;height:22px}#fe .icon{width:36px;height:36px;border-radius:11px}#fe .icon svg{width:18px;height:18px}
  #fe .menu{top:calc(var(--safe-t) + 58px);gap:2px}#fe .mi{font-size:19px;padding:7px 26px 7px 12px;min-width:170px;gap:10px}#fe .mi svg{width:19px;height:19px}
  #fe .play{width:min(240px,34vw);height:62px}#fe .play b{font-size:32px}#fe .play small{font-size:9.5px;letter-spacing:.24em}
  #fe .news{display:none}
  #fe .panel{top:calc(var(--safe-t) + 46px);bottom:calc(var(--safe-b) + 70px);width:min(330px,40vw);padding:12px 14px;border-radius:18px}#fe .panel.tall,#fe.onb .panel{top:var(--safe-t);bottom:var(--safe-b)}
  #fe .panel h2{font-size:22px}#fe .panel p{font-size:12px;margin-bottom:6px}#fe .row{padding:8px 0 9px}#fe .row>.lbl{margin-bottom:6px;font-size:10.5px}
  #fe .cz-name b{font-size:22px}#fe .arrow{flex-basis:38px;height:38px}#fe .skin{width:32px;height:32px}#fe .skin.on::after{inset:8px}#fe .of{padding:6px 8px}#fe .of i{flex-basis:22px;height:22px}#fe .of b{font-size:11.5px}
  #fe .onb-h{font-size:25px}#fe .in{height:40px;font-size:16px}#fe .btn{height:40px}#fe .cta{height:48px;font-size:19px}#fe .np b{font-size:19px}#fe .hint,#fe .tapnote{display:none}#fe .brandmark{display:none}
}
/* ---- portrait phones: tabs along the bottom, PLAY above them, panels as sheets ---- */
@media (max-width:760px) and (orientation:portrait){
  #fe .vig{background:linear-gradient(0deg,rgba(4,5,9,.82),rgba(4,5,9,0) 42%),linear-gradient(180deg,rgba(4,5,9,.55),rgba(4,5,9,0) 20%)}
  #fe .top{flex-wrap:wrap;gap:8px}#fe .me{order:1;padding:4px 12px 4px 4px;gap:9px}#fe .me .av{width:38px;height:38px;font-size:17px;border-radius:11px}#fe .me .who b{font-size:17px;max-width:110px}#fe .me .who i{font-size:9.5px}
  #fe .grow{display:none}#fe .brk{display:block;order:3;flex-basis:100%;height:0}#fe .pill{order:4;height:32px;font-size:20px;padding-right:12px}#fe .pill .ico{width:22px;height:22px}#fe .icon{order:2;margin-left:auto;width:40px;height:40px}
  #fe .menu{left:0;right:0;bottom:0;top:auto;flex-direction:row;gap:0;padding:6px var(--safe-l) var(--safe-b);background:linear-gradient(0deg,rgba(6,7,12,.94),rgba(6,7,12,.7));border-top:1px solid var(--line);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px)}
  #fe .mi{flex:1;flex-direction:column;gap:4px;font-size:11px;letter-spacing:.1em;padding:8px 0 6px;min-width:0;align-items:center;justify-content:center}
  #fe .mi::before{transform:none;border-left:none;border-top:3px solid transparent;border-radius:0;background:none}
  #fe .mi.sel::before{border-top-color:var(--teal);background:linear-gradient(180deg,rgba(45,224,200,.16),transparent)}
  #fe .mi.focus::after{transform:none;inset:2px}
  #fe .mi:hover{transform:none}
  #fe .mi svg{width:24px;height:24px}#fe .mi small{position:absolute;top:2px;right:8%;margin:0;font-size:8px;padding:1px 4px}
  #fe .mi.hide-p{display:none}
  #fe .play{left:var(--safe-l);right:var(--safe-r);width:auto;bottom:calc(var(--safe-b) + 62px);height:62px}
  #fe .play::before{transform:none}#fe .play::after{display:none}#fe .play b{font-size:34px}#fe .play small{font-size:10px}
  #fe .news,#fe .hint,#fe .tapnote{display:none}
  #fe .panel{left:var(--safe-l);right:var(--safe-r);width:auto;top:auto;bottom:calc(var(--safe-b) + 62px + 62px + 10px);height:min(42vh,420px);border-radius:20px 20px 16px 16px;animation:fe-sheet .35s cubic-bezier(.2,.9,.2,1)}
  @keyframes fe-sheet{from{opacity:0;transform:translateY(30px)}to{opacity:1;transform:none}}
  #fe .panel.tall{top:auto;bottom:calc(var(--safe-b) + 62px + 62px + 10px)}
  #fe.onb .panel{width:auto;left:var(--safe-l);right:var(--safe-r);top:auto;bottom:var(--safe-b);height:min(54vh,470px)}
  #fe .onb-h{font-size:27px}#fe .brandmark{display:none}
  #fe .np b{font-size:20px}
}
@media (prefers-reduced-motion:reduce){#fe .play::after{animation:none}#fe .panel,#fe .intro{animation:none}}
`;

interface News { tag: string; title: string; body: string; c: string }
const NEWS: News[] = [
  { tag: 'LAND', title: 'Plots are live', body: 'Every plot around Oshodi has an owner and a price. Open the LANDMAP and buy yours.', c: '#8b5cf6' },
  { tag: 'HUSTLE', title: 'Danfo runs', body: 'Conductor Sule pays ₦6,000 to move his bus to the next park. Do not scratch it.', c: '#f6c453' },
  { tag: 'ROADS', title: 'Mind the holes', body: 'Potholes come from real reports on real Lagos roads. Rain fills them. Drive with sense.', c: '#ff8a5c' },
  { tag: 'TIP', title: 'Your phone', body: 'Press T. Hustles, bank, land and the map are all in there.', c: '#2de0c8' },
];
const NAMES_A = ['Oshodi', 'Mushin', 'Yaba', 'Ikeja', 'Surulere', 'Lekki', 'Ajegunle', 'Ojuelegba', 'Maryland', 'Apapa', 'Agege', 'Bariga'];
const NAMES_B = ['Plug', 'King', 'Shadow', 'Gaffer', 'Wolf', 'Boss', 'Hustler', 'Ranger', 'Ace', 'Don', 'Queen', 'Gbedu'];
const suggest = () => `${NAMES_A[(Math.random() * NAMES_A.length) | 0]} ${NAMES_B[(Math.random() * NAMES_B.length) | 0]}`;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const initials = (s: string) => (s.match(/[\p{L}\p{N}]/gu) ?? ['?']).slice(0, 2).join('').toUpperCase();
const fmt = (n: number) => '₦' + Math.round(n).toLocaleString();

export interface Settings { vol: number; mus: number }
export function readSettings(): Settings { try { return { vol: 0.8, mus: 0.5, ...JSON.parse(localStorage.getItem('hustlelife.settings') ?? '{}') }; } catch { return { vol: 0.8, mus: 0.5 }; } }
const writeSettings = (s: Settings) => { try { localStorage.setItem('hustlelife.settings', JSON.stringify(s)); } catch { /* blocked */ } };

export interface FrontCtx {
  stage: LobbyStage; store: ProfileStore; baseLook: CharacterLook; touch: boolean; quality: 'low' | 'medium' | 'high';
  cash: () => number; bank: () => number; ownedPlots: () => number;
}
export type PlayChoice = { landmap: boolean; profile: Profile };
type Tab = 'play' | 'character' | 'garage' | 'land' | 'settings';
const TABS: { id: Tab; label: string; icon: string; soon?: boolean }[] = [
  { id: 'play', label: 'Play', icon: IC.play }, { id: 'character', label: 'Character', icon: IC.person }, { id: 'garage', label: 'Garage', icon: IC.car, soon: true },
  { id: 'land', label: 'Land', icon: IC.land }, { id: 'settings', label: 'Settings', icon: IC.gear },
];

export class FrontEnd {
  private root!: HTMLElement; private fade: HTMLElement;
  private draft: ProfileDraft = { name: '', model: 'survivor', skin: 1, outfit: 'street' };
  private profile: Profile | null = null;
  private tab: Tab = 'play'; private area: 'menu' | 'panel' = 'menu'; private rowIdx = 0;
  private mode: 'onboard' | 'lobby' = 'lobby';
  private device: 'kb' | 'pad' | 'touch' = 'kb';
  private padPrev: Record<string, boolean> = {}; private padRep = 0;
  private resolveLobby: ((c: PlayChoice) => void) | null = null; private resolveOnb: ((p: Profile) => void) | null = null;
  private busy = false; private saveT = 0; private newsI = 0; private newsT = 0;
  private np!: HTMLElement; private hudHidden: [HTMLElement, string][] = [];
  private keyH = (e: KeyboardEvent) => this.onKey(e);

  constructor(public ctx: FrontCtx) {
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    this.fade = document.createElement('div'); this.fade.id = 'fe-fade'; document.body.appendChild(this.fade);
  }

  // ---------------------------------------------------------------- shell
  private mount(mode: 'onboard' | 'lobby') {
    this.mode = mode;
    this.root?.remove();
    const r = this.root = document.createElement('div'); r.id = 'fe'; r.className = mode === 'onboard' ? 'onb' : '';
    r.innerHTML = `<div class="catch" id="fe-catch"></div><div class="vig"></div><div class="np" id="fe-np"><b class="disp"></b><i></i></div><div id="fe-ui"></div>`;
    document.body.appendChild(r);
    this.np = r.querySelector('#fe-np') as HTMLElement;
    // keep the game's own touch handlers (joystick, look) away from this screen
    for (const ev of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) r.addEventListener(ev, (e) => e.stopPropagation(), { passive: true });
    r.addEventListener('pointerdown', () => { this.setDevice(this.ctx.touch ? 'touch' : this.device); audio.init(); }, { capture: true });
    this.bindCatch(r.querySelector('#fe-catch') as HTMLElement);
    window.addEventListener('keydown', this.keyH);
    this.hideHud(true);
  }
  private hideHud(on: boolean) {
    if (on) { for (const id of ['hlhud', 'tc', 'joy-base', 'joy-knob', 'landmap']) { const el = document.getElementById(id); if (el) { this.hudHidden.push([el, el.style.display]); el.style.display = 'none'; } } }
    else { for (const [el, d] of this.hudHidden) el.style.display = d; this.hudHidden = []; }
  }
  private setDevice(d: 'kb' | 'pad' | 'touch') { if (this.device === d) return; this.device = d; this.renderHints(); }
  private ui() { return this.root.querySelector('#fe-ui') as HTMLElement; }
  private $(sel: string) { return this.root.querySelector(sel) as HTMLElement | null; }
  private cur(): ProfileDraft { return this.profile ? { name: this.profile.name, model: this.profile.model, skin: this.profile.skin, outfit: this.profile.outfit } : this.draft; }
  private lookNow(): CharacterLook { const d = this.cur(); return lookFor(d, this.ctx.baseLook); }
  private rebuildHero(pop = false) { this.ctx.stage.setHero(this.lookNow(), { pop }); }

  private applyLayout() {
    const w = innerWidth, h = innerHeight; const portrait = w < 760 && h > w; const compact = !portrait && h <= 520; const L = this.ctx.stage.layout;
    const panel = this.mode === 'onboard' || this.tab !== 'play';
    if (portrait) { L.shiftX = 0; L.shiftY = this.mode === 'onboard' ? 0.3 : panel ? 0.33 : 0.1; L.fyMax = panel ? 0.3 : 0.6; }
    else { L.shiftX = panel ? -0.19 : 0.04; L.shiftY = compact ? 0.01 : 0.0; L.fyMax = compact ? 0.64 : 0.7; if (compact && panel) L.shiftX = -0.2; }
    L.bust = 0;
  }

  private bindCatch(el: HTMLElement) {
    let down: { id: number; x: number; y: number; t: number; moved: number; lastX: number } | null = null;
    el.addEventListener('pointerdown', (e) => { if (down) return; el.setPointerCapture(e.pointerId); down = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), moved: 0, lastX: e.clientX }; this.ctx.stage.dragging = true; });
    el.addEventListener('pointermove', (e) => { if (!down || e.pointerId !== down.id) return; const dx = e.clientX - down.lastX; down.lastX = e.clientX; down.moved += Math.abs(dx); this.ctx.stage.dragBy(dx); });
    const end = (e: PointerEvent) => {
      if (!down || e.pointerId !== down.id) return; const d = down; down = null; this.ctx.stage.dragging = false;
      const dt = performance.now() - d.t, tot = e.clientX - d.x;
      if (d.moved < 7 && dt < 350 && this.mode === 'lobby' && this.tab !== 'character') { this.ctx.stage.nextEmote(); audio.ui('hover'); }
      else if (Math.abs(tot) > 80 && dt < 280 && Math.abs(e.clientY - d.y) < 90 && (this.mode === 'onboard' || this.tab === 'character')) { this.ctx.stage.spin = 0; this.stepModel(tot < 0 ? 1 : -1); }
    };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  }

  // ---------------------------------------------------------------- customizer (shared by creation and the Character tab)
  private customizer(): string {
    const d = this.cur(); const R = ROSTER[d.model]; const cap = customisable(d.model);
    return `<div class="row" data-row="model"><span class="lbl">Your hustler</span><div class="cz-model"><button class="arrow" data-act="prev" aria-label="Previous hustler">${svg(IC.left, 2.4)}</button>
        <div class="cz-name"><b class="disp" id="cz-n">${R.name}</b><span id="cz-b">${R.blurb}</span></div><button class="arrow" data-act="next" aria-label="Next hustler">${svg(IC.right, 2.4)}</button></div>
        <div class="dots" id="cz-dots">${ROSTER_IDS.map((id) => `<i class="${id === d.model ? 'on' : ''}"></i>`).join('')}</div></div>
      <div class="row" data-row="skin"><span class="lbl">Skin tone <span class="sub" id="cz-sn" style="letter-spacing:.04em;text-transform:none;font-family:Inter;font-weight:500">${SKIN_NAMES[d.skin]}</span></span>
        <div class="skins" id="cz-skins">${SKIN_TONES.map((c, i) => `<button class="skin${i === d.skin ? ' on' : ''}" data-skin="${i}" style="background:${c}" aria-label="${SKIN_NAMES[i]}"></button>`).join('')}</div>
        <div class="note" id="cz-skn" style="margin-top:8px;display:${cap.skin ? 'none' : 'block'}">${R.name}'s skin comes with the model. Pick another hustler to change tone.</div></div>
      <div class="row" data-row="outfit"><span class="lbl">Outfit</span>
        <div class="outfits" id="cz-outs">${OUTFITS.map((o) => `<button class="of${o.id === d.outfit ? ' on' : ''}" data-outfit="${o.id}"><i style="background:linear-gradient(135deg,${o.swatch[0]} 50%,${o.swatch[1]} 50%)"></i><div><b>${o.name}</b><span>${o.tag}</span></div></button>`).join('')}</div>
        <div class="note" id="cz-ofn" style="margin-top:8px;display:${cap.outfit ? 'none' : 'block'}">${R.name} wears an issued kit. Outfits do not apply.</div></div>`;
  }
  private refreshCustomizer() {
    const d = this.cur(); const R = ROSTER[d.model]; const cap = customisable(d.model);
    const set = (id: string, t: string) => { const e = this.$('#' + id); if (e) e.textContent = t; };
    set('cz-n', R.name); set('cz-b', R.blurb); set('cz-sn', SKIN_NAMES[d.skin]);
    this.root.querySelectorAll('#cz-dots i').forEach((e, i) => e.classList.toggle('on', ROSTER_IDS[i] === d.model));
    this.root.querySelectorAll('[data-skin]').forEach((e) => { e.classList.toggle('on', +(e as HTMLElement).dataset.skin! === d.skin); (e as HTMLElement).style.opacity = cap.skin ? '1' : '.35'; });
    this.root.querySelectorAll('[data-outfit]').forEach((e) => { e.classList.toggle('on', (e as HTMLElement).dataset.outfit === d.outfit); (e as HTMLElement).style.opacity = cap.outfit ? '1' : '.35'; });
    const a = this.$('#cz-skn'), b = this.$('#cz-ofn'); if (a) { a.style.display = cap.skin ? 'none' : 'block'; a.textContent = `${R.name}'s skin comes with the model. Pick another hustler to change tone.`; } if (b) { b.style.display = cap.outfit ? 'none' : 'block'; b.textContent = `${R.name} wears an issued kit. Outfits do not apply.`; }
  }
  private stepModel(dir: number) {
    const d = this.cur(); const i = (ROSTER_IDS.indexOf(d.model) + dir + ROSTER_IDS.length) % ROSTER_IDS.length; this.setModel(ROSTER_IDS[i]);
  }
  private setModel(id: RosterId) { this.patch({ model: id }); this.rebuildHero(true); this.refreshCustomizer(); this.updatePlate(); audio.ui('click'); }
  private patch(p: Partial<ProfileDraft>) {
    if (this.profile) { Object.assign(this.profile, p); window.clearTimeout(this.saveT); this.saveT = window.setTimeout(() => { void this.ctx.store.update({ model: this.profile!.model, skin: this.profile!.skin, outfit: this.profile!.outfit }).catch(() => {}); }, 350); }
    else Object.assign(this.draft, p);
  }
  private bindCustomizer(scope: HTMLElement) {
    scope.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest('[data-act],[data-skin],[data-outfit]') as HTMLElement | null; if (!t) return;
      if (t.dataset.act === 'prev') this.stepModel(-1); else if (t.dataset.act === 'next') this.stepModel(1);
      else if (t.dataset.skin !== undefined) { this.patch({ skin: +t.dataset.skin }); this.rebuildHero(); this.refreshCustomizer(); audio.ui('click'); }
      else if (t.dataset.outfit) { this.patch({ outfit: t.dataset.outfit }); this.rebuildHero(); this.refreshCustomizer(); audio.ui('click'); }
    });
  }

  // ---------------------------------------------------------------- onboarding
  /** Start the creation form on this hustler (carried over from an old save). */
  seed(model: string) { if (model in ROSTER) this.draft.model = model as RosterId; }
  /** First launch: name, hustler, skin, outfit. Saved once with the account. */
  async onboard(): Promise<Profile> {
    this.mount('onboard'); this.draft = { name: '', model: this.draft.model, skin: 1, outfit: 'street' }; this.profile = null; this.busy = false;
    this.rebuildHero(); this.applyLayout();
    const ui = this.ui();
    ui.innerHTML = `<div class="brandmark disp intro">Hustle<em>Life</em></div>
      <section class="panel gl tall" id="fe-panel"><div class="lbl">New hustler</div><h1 class="onb-h disp">Who are you<br>in <em>Lagos?</em></h1>
        <p>One profile per account. Pick your look now, change it any time from the lobby. Your name can be changed in Settings.</p>
        <div class="row" data-row="name"><span class="lbl">Street name</span><div class="field"><input class="in" id="fe-name" maxlength="${NAME_MAX + 4}" placeholder="3 to ${NAME_MAX} characters" autocomplete="off" autocapitalize="words" spellcheck="false" enterkeyhint="done"><button class="btn ghost sq" id="fe-dice" aria-label="Suggest a name">${svg(IC.dice)}</button></div><div class="err" id="fe-err"></div></div>
        ${this.customizer()}
        <div class="ctaw"><button class="btn cta disp" id="fe-go" disabled>Create hustler</button><div class="sub" style="text-align:center;margin-top:6px">Drag the hustler to turn them. Swipe to switch.</div></div></section>`;
    const panel = this.$('#fe-panel')!; this.bindCustomizer(panel);
    const input = this.$('#fe-name') as HTMLInputElement, err = this.$('#fe-err')!, go = this.$('#fe-go') as HTMLButtonElement;
    for (const ev of ['keydown', 'keyup', 'keypress']) input.addEventListener(ev, (e) => { e.stopPropagation(); if (ev === 'keydown' && (e as KeyboardEvent).key === 'Enter') { e.preventDefault(); void submit(); } });
    const check = (show: boolean) => {
      const v = validateName(input.value);
      if (v.ok) { go.disabled = false; err.className = 'err ok'; err.textContent = show ? `${v.name}. Good one.` : ''; input.classList.remove('bad'); }
      else { go.disabled = true; err.className = 'err'; err.textContent = show && input.value.length ? v.error : ''; input.classList.toggle('bad', show && input.value.length > 0); }
      this.draft.name = input.value.trim();
      this.updatePlate();
    };
    input.addEventListener('input', () => check(true));
    (this.$('#fe-dice') as HTMLElement).onclick = () => { input.value = suggest(); check(true); audio.ui('click'); };
    const submit = async () => {
      if (this.busy) return; const v = validateName(input.value); if (!v.ok) { check(true); input.focus(); audio.ui('denied'); return; }
      this.busy = true; go.disabled = true; go.textContent = 'Saving';
      try { this.profile = await this.ctx.store.create({ ...this.draft, name: v.name }); }
      catch (e: any) { err.className = 'err'; err.textContent = e?.message ?? 'Could not save. Try again.'; go.disabled = false; go.textContent = 'Create hustler'; this.busy = false; return; }
      this.busy = false; window.removeEventListener('keydown', this.keyH); audio.ui('pickup');
      this.resolveOnb?.(this.profile);
    };
    go.onclick = () => void submit();
    this.updatePlate(); this.renderHints();
    // focus the field on desktop only: on phones the keyboard would cover the hustler
    if (!this.ctx.touch) setTimeout(() => input.focus(), 400);
    return new Promise((res) => (this.resolveOnb = res));
  }
  private updatePlate() {
    const d = this.cur(); const nm = d.name || (this.mode === 'onboard' ? 'Your name' : '');
    (this.np.querySelector('b') as HTMLElement).textContent = nm;
    const lv = this.profile ? levelProgress(this.profile.xp).level : 1; (this.np.querySelector('i') as HTMLElement).textContent = this.mode === 'onboard' ? `${ROSTER[d.model].name.toUpperCase()}` : `LV ${lv}`;
    this.np.style.visibility = nm ? 'visible' : 'hidden';
  }

  // ---------------------------------------------------------------- lobby
  /** Every launch after the first: the profile loads straight into the lobby. Resolves when PLAY is pressed. */
  async lobby(profile: Profile): Promise<PlayChoice> {
    this.profile = profile; this.tab = 'play'; this.area = 'menu'; this.busy = false;
    const coming = this.root?.isConnected; // from profile creation: a beat of black between the two screens
    if (coming) { this.fade.classList.add('on'); await sleep(650); }
    this.mount('lobby'); this.rebuildHero(true); this.applyLayout();
    this.renderLobby();
    if (coming) { await sleep(120); this.fade.classList.remove('on'); }
    return new Promise((res) => (this.resolveLobby = res));
  }
  private renderLobby() {
    const p = this.profile!; const lp = levelProgress(p.xp);
    this.ui().innerHTML = `
      <header class="top intro"><button class="me gl" id="fe-me" aria-label="Profile and settings"><span class="av disp">${initials(p.name)}</span><span class="who"><b class="disp">${esc(p.name)}</b><i>LEVEL ${lp.level} · ${shortId(p.accountId)}</i></span><span class="xp"><u style="width:${Math.round(lp.frac * 100)}%"></u></span></button>
        <span class="grow"></span><span class="brk"></span>
        <div class="pill gl cash num" title="Cash"><span class="ico">${svg(IC.wallet)}</span><b id="fe-cash">${fmt(this.ctx.cash())}</b></div>
        <div class="pill gl bank num" title="Bank"><span class="ico">${svg(IC.bank)}</span><b id="fe-bank">${fmt(this.ctx.bank())}</b></div>
        <button class="icon gl" id="fe-gear" aria-label="Settings">${svg(IC.gear)}</button></header>
      <nav class="menu intro" id="fe-menu">${TABS.map((t) => `<button class="mi disp" data-tab="${t.id}"${t.id === 'play' ? ' data-p="1"' : ''}>${svg(t.icon)}<span>${t.label}</span>${t.soon ? '<small>SOON</small>' : ''}</button>`).join('')}</nav>
      <div id="fe-slot"></div>
      <div class="news intro" id="fe-news">${NEWS.map((n, i) => `<button class="tile gl" data-news="${i}" style="--c:${n.c}"><em>${n.tag}</em><b>${n.title}</b><span>${n.body}</span></button>`).join('')}</div>
      <button class="play disp intro" id="fe-play"><span><b>Play</b><small>Oshodi · Lagos</small></span></button>
      <div class="hint" id="fe-hint"></div>`;
    (this.$('#fe-menu')!).addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest('[data-tab]') as HTMLElement | null; if (b) { this.area = 'menu'; this.openTab(b.dataset.tab as Tab); audio.ui('click'); } });
    (this.$('#fe-play')!).onclick = () => void this.play(false);
    (this.$('#fe-me')!).onclick = () => { this.openTab('settings'); audio.ui('click'); };
    (this.$('#fe-gear')!).onclick = () => { this.openTab('settings'); audio.ui('click'); };
    this.openTab('play'); this.renderHints(); this.updatePlate();
  }
  private openTab(t: Tab) {
    this.tab = t; this.rowIdx = 0; if (t === 'play') this.area = 'menu';
    this.root.querySelectorAll('.mi').forEach((b) => b.classList.toggle('sel', (b as HTMLElement).dataset.tab === t));
    const slot = this.$('#fe-slot')!; const p = this.profile!;
    const news = this.$('#fe-news'); if (news) news.style.display = t === 'play' ? '' : 'none';
    if (t === 'play') { slot.innerHTML = ''; }
    else if (t === 'character') {
      slot.innerHTML = `<section class="panel gl" id="fe-panel"><div class="lbl">Locker</div><h2 class="disp">Character</h2><p>Swipe, use the arrows or press left and right to change hustler. Drag the hustler to turn them.</p>${this.customizer()}</section>`;
      this.bindCustomizer(this.$('#fe-panel')!);
    }
    else if (t === 'garage') {
      slot.innerHTML = `<section class="panel gl" id="fe-panel"><div class="lbl">Coming soon</div><h2 class="disp">Garage</h2><p>Cars you own will park here, with your paint and plates. For now, any car in Lagos can be yours if you are bold enough.</p>
        <div class="garage">${[1, 2, 3, 4].map((n) => `<div class="slot">${svg(IC.car, 1.6)}<span>SLOT ${n} · EMPTY</span></div>`).join('')}</div><div class="note">Buy, repair and paint cars from the phone once the garage opens.</div></section>`;
    }
    else if (t === 'land') {
      slot.innerHTML = `<section class="panel gl" id="fe-panel"><div class="lbl">Real estate</div><h2 class="disp">Land</h2><p>Land is the real money. The LANDMAP shows every plot around Oshodi, who owns it, what it costs and what the area is like.</p>
        <div class="row" data-row="land"><div class="kv"><span>Plots you own</span><b>${this.ctx.ownedPlots()}</b></div><div class="kv"><span>Cash</span><b>${fmt(this.ctx.cash())}</b></div><div class="kv"><span>Bank</span><b>${fmt(this.ctx.bank())}</b></div></div>
        <button class="btn big disp" id="fe-land" style="margin-top:8px">Open LANDMAP</button><div class="sub" style="margin-top:8px">You will spawn in Oshodi and the map opens straight away. Close it with M or Esc.</div></section>`;
      (this.$('#fe-land') as HTMLElement).onclick = () => void this.play(true);
    }
    else if (t === 'settings') {
      const s = readSettings();
      slot.innerHTML = `<section class="panel gl tall" id="fe-panel"><div class="lbl">Account</div><h2 class="disp">Settings</h2>
        <div class="row" data-row="name"><span class="lbl">Display name</span><div class="field"><input class="in" id="fe-name" maxlength="${NAME_MAX + 4}" value="${esc(p.name)}" autocomplete="off" spellcheck="false" enterkeyhint="done"><button class="btn" id="fe-save">Save</button></div><div class="err" id="fe-err"></div></div>
        <div class="row" data-row="acct"><span class="lbl">Profile</span><div class="kv"><span>Account ID</span><b>${shortId(p.accountId)}</b></div><div class="kv"><span>Created</span><b>${new Date(p.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</b></div><div class="note" style="margin-top:6px">One profile per account. Your hustler stays with this account.</div></div>
        <div class="row" data-row="gfx"><span class="lbl">Graphics</span><div class="seg" id="fe-q">${(['low', 'medium', 'high'] as const).map((q) => `<button data-q="${q}" class="${q === this.ctx.quality ? 'on' : ''}">${q[0].toUpperCase() + q.slice(1)}</button>`).join('')}</div><div class="sub" style="margin-top:6px">Changing quality restarts the game.</div></div>
        <div class="row" data-row="vol"><span class="lbl">Sound</span><div class="sub">Master</div><input type="range" id="fe-vol" min="0" max="100" value="${Math.round(s.vol * 100)}"><div class="sub">Music</div><input type="range" id="fe-mus" min="0" max="100" value="${Math.round(s.mus * 100)}"></div>
        <div class="row" data-row="keys"><span class="lbl">Controls</span><div class="kv"><span>Move / look</span><b>WASD · mouse</b></div><div class="kv"><span>Car, phone, map</span><b>E · T · M</b></div><div class="kv"><span>Gamepad</span><b>Sticks · A · Y · LB</b></div><div class="kv"><span>Touch</span><b>Left thumb · drag right</b></div></div></section>`;
      const input = this.$('#fe-name') as HTMLInputElement, err = this.$('#fe-err')!, save = this.$('#fe-save') as HTMLButtonElement;
      for (const ev of ['keydown', 'keyup', 'keypress']) input.addEventListener(ev, (e) => { e.stopPropagation(); if (ev === 'keydown' && (e as KeyboardEvent).key === 'Enter') { e.preventDefault(); save.click(); } });
      const doSave = async () => {
        const v = validateName(input.value); if (!v.ok) { err.className = 'err'; err.textContent = v.error; input.classList.add('bad'); audio.ui('denied'); return; }
        try { this.profile = await this.ctx.store.update({ name: v.name }); } catch (e: any) { err.className = 'err'; err.textContent = e?.message ?? 'Could not save.'; return; }
        input.classList.remove('bad'); input.value = this.profile.name; err.className = 'err ok'; err.textContent = 'Name saved.'; audio.ui('pickup');
        (this.$('.me .who b') as HTMLElement).textContent = this.profile.name; (this.$('.me .av') as HTMLElement).textContent = initials(this.profile.name); this.updatePlate();
      };
      save.onclick = () => void doSave();
      input.addEventListener('input', () => { input.classList.remove('bad'); err.textContent = ''; });
      (this.$('#fe-q')!).addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest('[data-q]') as HTMLElement | null; if (!b || b.dataset.q === this.ctx.quality) return; const u = new URL(location.href); u.searchParams.set('q', b.dataset.q!); location.href = u.toString(); });
      const sv = () => { const n = { vol: +(this.$('#fe-vol') as HTMLInputElement).value / 100, mus: +(this.$('#fe-mus') as HTMLInputElement).value / 100 }; writeSettings(n); audio.setVolume(n.vol, n.mus); };
      this.$('#fe-vol')!.addEventListener('input', sv); this.$('#fe-mus')!.addEventListener('input', sv);
    }
    this.applyLayout(); this.updatePlate();
    this.syncFocus();
  }

  // ---------------------------------------------------------------- play
  private async play(landmap: boolean) {
    if (this.busy || !this.resolveLobby) return; this.busy = true; audio.init(); audio.ui('pickup');
    window.removeEventListener('keydown', this.keyH);
    const L = this.ctx.stage.layout; L.bust = 1; L.shiftX = 0; L.shiftY = -0.02;
    this.fade.classList.add('on'); this.root.style.pointerEvents = 'none';
    await sleep(720);
    this.resolveLobby?.({ landmap, profile: this.profile! }); this.resolveLobby = null;
  }
  /** Called by the game once the world is live: remove the lobby UI and fade the black away. */
  async release() {
    window.removeEventListener('keydown', this.keyH);
    this.root?.remove(); this.hideHud(false); this.busy = false;
    await sleep(60); this.fade.classList.remove('on'); await sleep(700);
  }

  // ---------------------------------------------------------------- input: keyboard, gamepad
  private onKey(e: KeyboardEvent) {
    if ((e.target as HTMLElement)?.tagName === 'INPUT' && (e.target as HTMLInputElement).type !== 'range') return;
    this.setDevice('kb'); audio.init();
    const k = e.code; let used = true;
    if (this.mode === 'onboard') {
      if (k === 'ArrowLeft') this.stepModel(-1); else if (k === 'ArrowRight') this.stepModel(1); else used = false;
    } else if (k === 'KeyP' || (k === 'Enter' && this.area === 'menu' && this.tab === 'play')) void this.play(false);
    else if (k === 'ArrowUp' || k === 'KeyW') this.navMenu(-1);
    else if (k === 'ArrowDown' || k === 'KeyS') this.navMenu(1);
    else if (k === 'ArrowLeft' || k === 'KeyA') this.horiz(-1);
    else if (k === 'ArrowRight' || k === 'KeyD') this.horiz(1);
    else if (k === 'Enter' || k === 'Space') this.confirm();
    else if (k === 'Escape' || k === 'Backspace') this.back();
    else used = false;
    if (used) e.preventDefault();
  }
  private navMenu(dir: number) {
    if (this.area === 'panel') { this.moveRow(dir); return; }
    const i = TABS.findIndex((t) => t.id === this.tab); const n = TABS[(i + dir + TABS.length) % TABS.length]; this.openTab(n.id); audio.ui('hover');
  }
  private panelRows(): HTMLElement[] { return [...this.root.querySelectorAll('#fe-panel .row[data-row]')] as HTMLElement[]; }
  private moveRow(dir: number) { const rows = this.panelRows(); if (!rows.length) return; this.rowIdx = (this.rowIdx + dir + rows.length) % rows.length; this.syncFocus(); audio.ui('hover'); rows[this.rowIdx].scrollIntoView({ block: 'nearest' }); }
  private syncFocus() {
    this.root.querySelectorAll('.focus').forEach((e) => e.classList.remove('focus'));
    if (this.device === 'touch') return;
    if (this.area === 'panel') this.panelRows()[this.rowIdx]?.classList.add('focus'); else this.root.querySelector(`.mi[data-tab="${this.tab}"]`)?.classList.add('focus');
  }
  private horiz(dir: number) {
    if (this.area === 'menu') { if (this.tab === 'character') this.stepModel(dir); else if (dir > 0 && this.tab !== 'play') this.confirm(); return; }
    const row = this.panelRows()[this.rowIdx]?.dataset.row;
    if (row === 'model') this.stepModel(dir);
    else if (row === 'skin') { const d = this.cur(); this.patch({ skin: Math.max(0, Math.min(5, d.skin + dir)) }); this.rebuildHero(); this.refreshCustomizer(); audio.ui('click'); }
    else if (row === 'outfit') { const d = this.cur(); const i = (OUTFITS.findIndex((o) => o.id === d.outfit) + dir + OUTFITS.length) % OUTFITS.length; this.patch({ outfit: OUTFITS[i].id }); this.rebuildHero(); this.refreshCustomizer(); audio.ui('click'); }
    else if (row === 'gfx') { const qs = ['low', 'medium', 'high']; const i = qs.indexOf(this.ctx.quality) + dir; if (i >= 0 && i < 3) (this.root.querySelector(`[data-q="${qs[i]}"]`) as HTMLElement)?.click(); }
    else if (row === 'vol') { const r = this.$('#fe-vol') as HTMLInputElement; r.value = String(Math.max(0, Math.min(100, +r.value + dir * 10))); r.dispatchEvent(new Event('input')); }
  }
  private confirm() {
    if (this.area === 'menu') {
      if (this.tab === 'play') { void this.play(false); return; }
      if (this.tab === 'land') { void this.play(true); return; }
      if (this.tab === 'garage') { audio.ui('denied'); return; }
      this.area = 'panel'; this.rowIdx = 0; this.syncFocus(); audio.ui('click'); return;
    }
    const row = this.panelRows()[this.rowIdx]?.dataset.row;
    if (row === 'name') { (this.$('#fe-name') as HTMLInputElement)?.focus(); }
    else if (row === 'skin' || row === 'outfit' || row === 'model') this.horiz(1);
    else if (row === 'land') void this.play(true);
  }
  private back() { if (this.area === 'panel') { this.area = 'menu'; this.syncFocus(); } else if (this.tab !== 'play') this.openTab('play'); audio.ui('click'); }

  private renderHints() {
    const el = this.$('#fe-hint'); if (!el) return;
    if (this.device === 'touch') { el.innerHTML = ''; return; }
    const pad = this.device === 'pad';
    el.innerHTML = this.mode === 'onboard' ? '' : pad
      ? `<span><kbd>D-pad</kbd>Move</span><span><kbd>A</kbd>Select</span><span><kbd>B</kbd>Back</span><span><kbd>LB</kbd><kbd>RB</kbd>Hustler</span><span><kbd>Start</kbd>Play</span>`
      : `<span><kbd>↑↓</kbd>Menu</span><span><kbd>←→</kbd>Switch</span><span><kbd>Enter</kbd>Select</span><span><kbd>Esc</kbd>Back</span><span><kbd>P</kbd>Play</span>`;
  }

  /** Every frame: gamepad, name plate position, news rotation, live money. */
  update(dt: number) {
    if (!this.root || !this.root.isConnected) return;
    this.pollPad(dt);
    // name plate above the hero's head
    const st = this.ctx.stage; if (st.active && st.hero) {
      const v = st.localToWorld(new THREE.Vector3(0, 2.0, 0)).project(st.view.camera);
      const x = (v.x * 0.5 + 0.5) * innerWidth, y = (-v.y * 0.5 + 0.5) * innerHeight; this.np.style.display = innerWidth < 760 && innerHeight > innerWidth ? 'none' : ''; this.np.style.transform = `translate(${x}px,${y}px) translate(-50%,-100%)`;
    }
    if (this.mode === 'lobby') {
      this.newsT += dt; if (this.newsT > 6) { this.newsT = 0; this.newsI = (this.newsI + 1) % NEWS.length; const tiles = [...this.root.querySelectorAll('.tile')] as HTMLElement[]; if (innerHeight <= 520 || innerWidth < 760) return; tiles.forEach((t, i) => (t.style.borderColor = i === this.newsI ? 'rgba(255,255,255,.3)' : '')); }
      const c = this.$('#fe-cash'), b = this.$('#fe-bank'); if (c) c.textContent = fmt(this.ctx.cash()); if (b) b.textContent = fmt(this.ctx.bank());
    }
  }
  private pollPad(dt: number) {
    const pads = navigator.getGamepads?.() ?? []; const gp = [...pads].find((p) => p && p.connected); if (!gp) return;
    const b = (i: number) => !!gp.buttons[i]?.pressed; const ax = (i: number) => gp.axes[i] ?? 0;
    const now: Record<string, boolean> = { a: b(0), b: b(1), start: b(9), lb: b(4), rb: b(5), up: b(12) || ax(1) < -0.6, down: b(13) || ax(1) > 0.6, left: b(14) || ax(0) < -0.6, right: b(15) || ax(0) > 0.6 };
    const any = Object.values(now).some(Boolean); if (any) { this.setDevice('pad'); audio.init(); }
    const edge = (k: string) => now[k] && !this.padPrev[k];
    // hold a direction to repeat
    this.padRep -= dt; const rep = (k: string) => { if (edge(k)) { this.padRep = 0.38; return true; } if (now[k] && this.padRep <= 0) { this.padRep = 0.11; return true; } return false; };
    if (this.mode === 'onboard') { if (edge('lb') || rep('left')) this.stepModel(-1); if (edge('rb') || rep('right')) this.stepModel(1); }
    else if (!this.busy) {
      if (edge('start')) void this.play(false);
      if (rep('up')) this.navMenu(-1); if (rep('down')) this.navMenu(1);
      if (rep('left')) this.horiz(-1); if (rep('right')) this.horiz(1);
      if (edge('lb')) this.stepModel(-1); if (edge('rb')) this.stepModel(1);
      if (edge('a')) this.confirm(); if (edge('b')) this.back();
    }
    const rx = ax(2); if (Math.abs(rx) > 0.2) { this.ctx.stage.spin += rx * dt * 2.4; this.ctx.stage.dragging = false; }
    this.padPrev = now;
  }
}

function esc(s: string) { return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!)); }
