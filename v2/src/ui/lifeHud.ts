// HustleLife HUD, modern RP style: glass panels, money pills, toasts, an incoming-call card, a dark minimap with
// a teal GPS route, a speed arc with the gear, a parcel card for the land under your feet, the LANDMAP overlay,
// and the phone in the hand.
import { appIcon, appAccent } from './phoneIcons';
import type { SimEvent } from '../sim/types';
import type { LifeSim } from '../sim/life';
import type { RoadNet, Lane } from '../world/roadnet';
import type { Plot } from '../world/plots';
import { intro as loadScreen } from './intro';

const css = `
:root{--glass:rgba(12,14,22,.56);--glass2:rgba(18,20,32,.72);--line:rgba(255,255,255,.09);--txt:#f3f5f8;--mut:#9ba3b4;--teal:#2de0c8;--pur:#8b5cf6;--pur2:#6d3ef0;--grn:#49e08a;--red:#ff4d5e;--gold:#ffc53d;--blue:#4aa8ff}
#hlhud{position:fixed;inset:0;pointer-events:none;font-family:Inter,system-ui,-apple-system,Segoe UI,sans-serif;color:var(--txt);z-index:5;user-select:none;-webkit-font-smoothing:antialiased}
.gl{background:var(--glass);border:1px solid var(--line);backdrop-filter:blur(14px) saturate(140%);-webkit-backdrop-filter:blur(14px) saturate(140%);box-shadow:0 8px 24px rgba(0,0,0,.28)}
.num{font-family:Rajdhani,Inter,sans-serif;font-weight:700;letter-spacing:.3px}
.ts{text-shadow:0 1px 2px rgba(0,0,0,.7),0 0 10px rgba(0,0,0,.35)}
#tr{position:absolute;right:max(18px,env(safe-area-inset-right));top:max(14px,env(safe-area-inset-top));display:flex;flex-direction:column;align-items:flex-end;gap:7px}
.pills{display:flex;gap:7px}
.pill{display:flex;align-items:center;gap:8px;height:36px;padding:0 14px 0 6px;border-radius:999px;font-size:19px}
.pill .ico{width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center}
.pill .ico svg{width:15px;height:15px;fill:none;stroke:#0b0d14;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
#p-cash .ico{background:var(--grn)} #p-bank .ico{background:var(--blue)}
#p-cash b{color:#c9f7da} #p-bank b{color:#d4e8ff}
#p-time{height:30px;font-size:13px;font-weight:600;padding:0 12px;gap:8px;color:#dfe4ee}
#p-time .num{font-size:17px;color:#fff}
#stars{display:flex;gap:4px;padding:5px 10px;border-radius:999px}
#stars svg{width:17px;height:17px;fill:rgba(255,255,255,.14)} #stars svg.on{fill:var(--gold);filter:drop-shadow(0 0 4px rgba(255,197,61,.6))}
#stars.flash svg.on{animation:fl .45s steps(2) infinite} @keyframes fl{50%{fill:#fff}}
#stars.none{display:none}
#p-me{height:36px;padding:0 14px 0 5px;gap:9px;font-size:15px;font-weight:700;max-width:200px}
#p-me .av{width:26px;height:26px;border-radius:9px;background:linear-gradient(140deg,var(--pur),var(--teal));display:flex;align-items:center;justify-content:center;font-family:Oswald,Rajdhani,sans-serif;font-size:13px;font-weight:700;color:#fff;flex:0 0 auto}
#p-me .nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:Oswald,Rajdhani,sans-serif;font-weight:600;letter-spacing:.04em;text-transform:uppercase}
#p-me .lv{font-family:Teko,Rajdhani,sans-serif;font-weight:600;font-size:17px;color:var(--teal);letter-spacing:.06em;flex:0 0 auto}
#nameplate{position:absolute;left:0;top:0;display:none;flex-direction:column;align-items:center;gap:1px;pointer-events:none;white-space:nowrap;will-change:transform}
#nameplate b{font-family:Oswald,Rajdhani,sans-serif;font-weight:600;font-size:15px;letter-spacing:.08em;text-transform:uppercase;padding:2px 10px 1px;border-radius:6px;background:rgba(8,10,16,.5);border:1px solid rgba(255,255,255,.14);text-shadow:0 1px 3px rgba(0,0,0,.8)}
#nameplate i{font-style:normal;font-family:Teko,Rajdhani,sans-serif;font-weight:600;font-size:13px;letter-spacing:.14em;color:var(--teal);text-shadow:0 1px 3px rgba(0,0,0,.9)}
#flash{font-size:22px;opacity:0;transition:opacity .4s;margin-right:6px}
#toasts{position:absolute;left:max(18px,env(safe-area-inset-left));top:max(14px,env(safe-area-inset-top));display:flex;flex-direction:column;gap:8px;width:min(330px,60vw)}
.toast{display:flex;gap:11px;align-items:flex-start;padding:11px 13px;border-radius:16px;animation:tin .35s cubic-bezier(.2,.9,.2,1);transition:opacity .4s,transform .4s}
.toast.out{opacity:0;transform:translateX(-24px)}
@keyframes tin{from{opacity:0;transform:translateX(-30px)}to{opacity:1;transform:none}}
.toast .ti{flex:0 0 34px;height:34px;border-radius:11px;display:flex;align-items:center;justify-content:center}
.toast .ti svg{width:18px;height:18px;fill:none;stroke:#fff;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.toast h4{margin:0 0 2px;font-size:13.5px;font-weight:700} .toast p{margin:0;font-size:12.5px;line-height:1.35;color:#cfd5e1}
#call{position:absolute;left:50%;top:max(14px,env(safe-area-inset-top));transform:translate(-50%,-140%);transition:transform .45s cubic-bezier(.2,.9,.2,1);display:flex;align-items:center;gap:12px;padding:10px 12px 10px 10px;border-radius:22px;min-width:min(380px,88vw);pointer-events:auto}
#call.on{transform:translate(-50%,0)}
#call .av{width:46px;height:46px;border-radius:50%;background:linear-gradient(140deg,var(--pur),#e0578f);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:19px}
#call .who{flex:1;min-width:0} #call .who b{display:block;font-size:15px} #call .who span{font-size:12.5px;color:var(--mut);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block}
#call button{width:44px;height:44px;border-radius:50%;border:none;display:flex;align-items:center;justify-content:center;cursor:pointer}
#call button svg{width:20px;height:20px;fill:none;stroke:#fff;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
#call .no{background:var(--red)} #call .yes{background:#22c55e;animation:ring 1.2s ease-in-out infinite}
@keyframes ring{0%,100%{transform:rotate(0)}10%,30%{transform:rotate(-12deg)}20%,40%{transform:rotate(12deg)}50%{transform:rotate(0)}}
#mm{position:absolute;left:max(18px,env(safe-area-inset-left));bottom:max(16px,env(safe-area-inset-bottom));width:min(270px,34vw)}
#mmhead{display:flex;flex-direction:column;gap:1px;margin:0 0 7px 4px;white-space:nowrap;overflow:hidden}
#mmhead b{font-size:17px;font-weight:800;letter-spacing:.2px} #mmhead span{font-size:12.5px;color:#cfd5e1}
#radarw{position:relative;border-radius:18px;overflow:hidden;padding:0;aspect-ratio:1.55}
#radar{display:block;width:100%;height:100%}
#mmdir{position:absolute;right:9px;top:8px;font-size:11px;font-weight:700;color:#cfd5e1;padding:3px 8px;border-radius:999px;background:rgba(0,0,0,.35)}
#vitals{display:flex;gap:6px;margin-top:7px}
#vitals .v{flex:1;height:7px;border-radius:999px;background:rgba(0,0,0,.45);overflow:hidden;border:1px solid var(--line)}
#vitals .v i{display:block;height:100%;border-radius:999px;transition:width .25s}
#hp{background:linear-gradient(90deg,#2fbf71,#5ff0a0)} #hp.low{background:linear-gradient(90deg,#e0303f,#ff6b78)} #ar{background:linear-gradient(90deg,#2f7fe0,#6ab8ff)}
#wcard{position:absolute;right:max(18px,env(safe-area-inset-right));bottom:max(18px,env(safe-area-inset-bottom));display:none;align-items:center;gap:12px;padding:10px 16px 10px 12px;border-radius:18px}
#wcard .wi{width:40px;height:40px;border-radius:12px;background:rgba(255,255,255,.07);display:flex;align-items:center;justify-content:center}
#wcard .wi svg{width:24px;height:24px;fill:none;stroke:#fff;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
#wcard b{display:block;font-size:14px} #wcard .num{font-size:22px;line-height:1} #wcard .num small{font-size:14px;color:var(--mut)}
#speedo{position:absolute;right:max(14px,env(safe-area-inset-right));bottom:max(10px,env(safe-area-inset-bottom));width:min(210px,30vw);aspect-ratio:1;display:none}
#speedo svg{width:100%;height:100%;overflow:visible}
#speedo .sv{position:absolute;left:0;right:0;top:36%;text-align:center}
#speedo .sv .num{font-size:min(52px,7.4vw);line-height:.9;display:block} #speedo .sv small{font-size:11px;font-weight:700;color:var(--mut);letter-spacing:1.5px}
#speedo .gear{position:absolute;left:50%;bottom:16%;transform:translateX(-50%);width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:19px;border:1.5px solid var(--teal);color:var(--teal);background:rgba(10,12,20,.6)}
#parcel{position:absolute;left:calc(max(18px,env(safe-area-inset-left)) + min(270px,34vw) + 14px);bottom:max(16px,env(safe-area-inset-bottom));width:min(260px,40vw);padding:12px 14px;border-radius:18px;display:none;pointer-events:auto}
#parcel .k{font-size:10.5px;font-weight:700;letter-spacing:1.4px;color:var(--teal);text-transform:uppercase}
#parcel h5{margin:3px 0 8px;font-size:16px;font-weight:800}
#parcel .own{display:flex;align-items:center;gap:8px;font-size:12.5px;color:#cfd5e1;margin-bottom:9px}
#parcel .own i{width:24px;height:24px;border-radius:50%;background:linear-gradient(140deg,#f59e0b,#ef4444);display:flex;align-items:center;justify-content:center;font-style:normal;font-weight:800;font-size:11px;color:#fff}
#parcel .row{display:flex;justify-content:space-between;font-size:12.5px;color:var(--mut);margin-top:3px} #parcel .row b{color:#fff;font-weight:600}
#parcel .price{font-size:22px;color:#fff;margin-top:6px}
.btn{pointer-events:auto;cursor:pointer;border:none;border-radius:12px;padding:10px 14px;font-family:Inter,sans-serif;font-weight:800;font-size:13px;color:#fff;background:linear-gradient(180deg,var(--pur),var(--pur2));box-shadow:0 6px 16px rgba(109,62,240,.4),inset 0 1px 0 rgba(255,255,255,.25)}
.btn.ghost{background:rgba(255,255,255,.08);box-shadow:none}
.btn kbd{font-family:Rajdhani,sans-serif;font-size:12px;background:rgba(0,0,0,.3);border-radius:5px;padding:0 5px;margin-left:6px}
#subs{position:absolute;left:50%;transform:translateX(-50%);bottom:24%;max-width:min(720px,86vw);text-align:center;font-size:20px;font-weight:600;line-height:1.3;padding:0}
#subs:not(:empty){padding:8px 16px;border-radius:14px;background:rgba(8,10,16,.55);backdrop-filter:blur(8px)}
#subs .who{color:var(--teal);font-weight:800}
#help{position:absolute;left:50%;transform:translateX(-50%);top:max(64px,calc(env(safe-area-inset-top) + 60px));max-width:min(560px,80vw);padding:10px 16px;border-radius:14px;font-size:14px;font-weight:500;line-height:1.4;display:none;text-align:center}
#help kbd,#prompt kbd{font-family:Rajdhani,sans-serif;font-weight:700;font-size:13px;background:#fff;color:#0b0d14;border-radius:6px;padding:1px 7px;margin:0 3px}
#title{position:absolute;left:0;right:0;top:30%;text-align:center;opacity:0;transition:opacity .6s,transform .6s;transform:translateY(8px)}
#title.on{opacity:1;transform:none}
#title .t{display:inline-block;font-family:Anton,Impact,sans-serif;font-size:min(58px,9vw);letter-spacing:3px;background:linear-gradient(180deg,#fff,#cfd8ff);-webkit-background-clip:text;background-clip:text;color:transparent;filter:drop-shadow(0 3px 10px rgba(0,0,0,.5))}
#title small{display:block;font-size:15px;font-weight:600;color:#dfe4ee;letter-spacing:2px;text-transform:uppercase;margin-top:4px}
#title .bar{width:120px;height:3px;margin:10px auto 0;border-radius:2px;background:linear-gradient(90deg,transparent,var(--teal),transparent)}
#title.danger .t{background:linear-gradient(180deg,#fff,#ff8a94);-webkit-background-clip:text;background-clip:text} #title.danger .bar{background:linear-gradient(90deg,transparent,var(--red),transparent)}
#prompt{position:absolute;left:50%;top:63%;transform:translateX(-50%);font-size:14px;font-weight:600;padding:8px 14px;border-radius:999px;display:none}
#xhair{position:absolute;left:50%;top:50%;width:22px;height:22px;margin:-11px 0 0 -11px;display:none}
#xhair:before,#xhair:after{content:'';position:absolute;background:#fff;box-shadow:0 0 2px #000}
#xhair:before{left:10px;top:0;width:2px;height:22px;clip-path:polygon(0 0,100% 0,100% 30%,0 30%,0 70%,100% 70%,100% 100%,0 100%)}
#xhair:after{top:10px;left:0;height:2px;width:22px;clip-path:polygon(0 0,30% 0,30% 100%,0 100%,0 0,70% 0,100% 0,100% 100%,70% 100%)}
#phone{position:absolute;right:max(28px,env(safe-area-inset-right));bottom:-120%;width:min(318px,44vh);aspect-ratio:9/19.3;border-radius:44px;background:linear-gradient(150deg,#5b5d66,#1b1c21 30%,#0b0b0e 70%,#2a2b31);padding:8px;box-shadow:0 30px 70px rgba(0,0,0,.65),inset 0 0 0 1.5px rgba(255,255,255,.16),inset 0 0 0 4px #0b0b0e;transform:rotate(-3deg);transform-origin:100% 100%;transition:bottom .38s cubic-bezier(.2,.8,.2,1);pointer-events:auto;z-index:8}
#phone.up{bottom:max(16px,env(safe-area-inset-bottom))}
#phone{width:calc(min(318px,44vh) * var(--ps,1))}
#phone.tab{aspect-ratio:3/4.1;width:min(470px,66vh);border-radius:30px;transform:rotate(-1.5deg)} #phone.tab #scr{border-radius:24px} #phone.tab #apps{grid-template-columns:repeat(6,1fr)} #phone.tab .isl{display:none}
#phone.small{border-radius:30px;background:linear-gradient(150deg,#3a3f4a,#15171c 40%,#0b0b0e)} #phone.small #scr{border-radius:22px} #phone.small .isl{display:none}
#ph-crack{position:absolute;inset:0;pointer-events:none;z-index:30;opacity:0;background-repeat:no-repeat;background-size:100% 100%;mix-blend-mode:screen}

#scr{position:relative;width:100%;height:100%;border-radius:37px;overflow:hidden;color:#fff;background:#0b0d16;font-family:Inter,system-ui,sans-serif}
#scr .wall{position:absolute;inset:0;background:radial-gradient(120% 60% at 85% -5%,rgba(255,140,60,.55),transparent 60%),radial-gradient(90% 55% at -10% 30%,rgba(139,92,246,.5),transparent 65%),radial-gradient(90% 50% at 50% 115%,rgba(45,224,200,.45),transparent 70%),linear-gradient(180deg,#1a1430,#0b0d16 70%)}
#scr .wall:after{content:'';position:absolute;left:0;right:0;bottom:23%;height:16%;opacity:.35;background:linear-gradient(0deg,#05060b,transparent);-webkit-mask:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 300 60' preserveAspectRatio='none'><path d='M0 60V40h14V28h10v12h8V18h12v22h6V30h16v-8h6v8h10v10h12V12h14v28h8V26h10v14h16V20h8v-6h6v6h8v20h12V30h14v10h10V24h16v16h12v20z'/></svg>") bottom/100% 100% no-repeat;mask:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 300 60' preserveAspectRatio='none'><path d='M0 60V40h14V28h10v12h8V18h12v22h6V30h16v-8h6v8h10v10h12V12h14v28h8V26h10v14h16V20h8v-6h6v6h8v20h12V30h14v10h10V24h16v16h12v20z'/></svg>") bottom/100% 100% no-repeat}
#scr .isl{position:absolute;top:9px;left:50%;width:84px;height:24px;margin-left:-42px;background:#000;border-radius:14px;z-index:6}
#scr .st{position:relative;z-index:5;display:flex;justify-content:space-between;align-items:center;padding:12px 22px 0 26px;font-size:12.5px;font-weight:700;letter-spacing:.2px;height:24px}
#scr .st i{font-style:normal;display:inline-flex;gap:5px;align-items:center;font-size:11px}
#scr .st i b{display:inline-block;width:22px;height:11px;border-radius:3px;border:1.4px solid rgba(255,255,255,.75);position:relative} #scr .st i b:after{content:'';position:absolute;inset:1.5px;right:35%;background:#fff;border-radius:1.5px}
#scr .big{position:relative;padding:20px 0 0;text-align:center;font-family:Inter,system-ui,sans-serif;font-size:58px;font-weight:300;letter-spacing:-1px;line-height:1}
#scr .small{position:relative;text-align:center;font-size:12px;font-weight:600;opacity:.85;margin-top:4px}
#apps{position:relative;display:grid;grid-template-columns:repeat(4,1fr);gap:14px 2px;padding:20px 12px 96px;max-height:calc(100% - 210px);overflow-y:auto;scrollbar-width:none}
#apps::-webkit-scrollbar{display:none}
#apps button,#dock button{background:none;border:none;color:#fff;font-family:inherit;font-size:10.5px;font-weight:500;letter-spacing:.1px;display:flex;flex-direction:column;align-items:center;gap:5px;padding:0;cursor:pointer;text-shadow:0 1px 3px rgba(0,0,0,.55);-webkit-tap-highlight-color:transparent;min-width:0}
#apps button em,#dock button em{font-style:normal;max-width:62px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#apps .ico,#dock .ico{width:50px;height:50px;display:block;transition:transform .12s;filter:drop-shadow(0 3px 6px rgba(0,0,0,.35))}
#apps button:active .ico,#dock button:active .ico{transform:scale(.9)}
#apps button.sel .ico,#dock button.sel .ico{transform:scale(1.1);filter:drop-shadow(0 0 0 #fff) drop-shadow(0 0 6px rgba(255,255,255,.9))}
#apps .iw,#dock .iw{position:relative;display:block} #apps .iw u,#dock .iw u{position:absolute;top:-4px;right:-4px;min-width:18px;height:18px;padding:0 4px;box-sizing:border-box;border-radius:9px;background:#ff3b30;color:#fff;font:700 11px/18px Inter,sans-serif;text-decoration:none;text-align:center;box-shadow:0 0 0 2px rgba(0,0,0,.15)}
#dock{position:absolute;left:10px;right:10px;bottom:16px;height:72px;border-radius:26px;background:rgba(255,255,255,.16);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);display:grid;grid-template-columns:repeat(4,1fr);align-items:center;padding:0 6px;z-index:2}
#dock button em{display:none}
#appview{position:absolute;inset:0;background:#f2f3f7;color:#11131a;display:none;flex-direction:column;z-index:4;animation:avin .22s cubic-bezier(.2,.8,.2,1)}
@keyframes avin{from{transform:translateX(18%);opacity:.4}}
#appview .nav{display:flex;align-items:center;gap:6px;padding:38px 10px 10px;background:var(--ac,#333);color:#fff;box-shadow:0 1px 0 rgba(0,0,0,.08)}
#appview .nav .bk{display:flex;align-items:center;gap:2px;border:none;background:rgba(255,255,255,.18);color:#fff;font:600 13px Inter,sans-serif;padding:6px 10px 6px 6px;border-radius:999px;cursor:pointer;pointer-events:auto;-webkit-tap-highlight-color:transparent}
#appview .nav .bk svg{width:16px;height:16px;fill:none;stroke:#fff;stroke-width:2.6;stroke-linecap:round;stroke-linejoin:round}
#appview .nav .ai{width:26px;height:26px;margin-left:4px} #appview .nav .ai .ico{width:26px;height:26px;display:block}
#appview h3{margin:0;flex:1;font-size:17px;font-weight:800;letter-spacing:.1px;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#appview .list{padding:10px 10px 8px;display:flex;flex-direction:column;gap:8px;overflow:auto;flex:1;scrollbar-width:thin}
#appview .row{background:#fff;border:none;border-radius:16px;padding:12px 13px;font-size:12.5px;font-weight:500;line-height:1.4;color:#4b5263;pointer-events:auto;box-shadow:0 1px 2px rgba(16,24,40,.06),0 1px 1px rgba(16,24,40,.04)}
#appview .row b{display:block;font-size:14px;font-weight:700;margin-bottom:3px;color:#11131a;letter-spacing:-.1px}
#appview .row.sel{box-shadow:0 0 0 2px var(--ac,#6d3ef0)}
#appview .row br+.btn,#appview .row .btn{margin-top:9px}
#appview .row .btn{background:var(--ac,#6d3ef0);box-shadow:none;border-radius:999px;padding:8px 14px;font-size:12px;font-weight:700;margin-right:4px}
#appview .row .btn[disabled]{opacity:.45}
#appview .row input,#appview .row textarea,#appview .row select{width:100%;box-sizing:border-box;margin-top:8px;padding:10px 12px;border-radius:12px;border:1px solid #d7dae3;background:#f7f8fb;font:500 13px Inter,sans-serif;color:#11131a;pointer-events:auto}
#appview canvas{width:100%;border-radius:14px;background:#151826}
#appview .back{margin:8px auto 10px;width:118px;height:5px;background:#11131a;opacity:.35;border:none;border-radius:3px;padding:0;pointer-events:auto;cursor:pointer;flex:none}
#scr .home{position:absolute;left:50%;bottom:6px;width:118px;height:5px;margin-left:-59px;border-radius:3px;background:#fff;opacity:.6;z-index:3}
@media (max-height:560px){#phone{transform:none;width:min(360px,58vw);aspect-ratio:auto;height:calc(100vh - 24px);border-radius:30px}#phone.up{bottom:12px}#scr{border-radius:24px}#scr .big{font-size:40px;padding-top:8px}#apps{grid-template-columns:repeat(5,1fr);max-height:calc(100% - 150px);padding-top:10px}#appview .nav{padding-top:30px}#scr .isl{display:none}}
body.phone-up #nt-badge{display:none}
#landmap{position:fixed;inset:0;z-index:6;display:none;pointer-events:none;font-family:Inter,sans-serif;color:var(--txt)}
#landmap.on{display:block}
#lm-top{position:absolute;left:max(18px,env(safe-area-inset-left));top:max(14px,env(safe-area-inset-top));display:flex;align-items:center;gap:12px;padding:10px 14px;border-radius:16px;pointer-events:auto}
#lm-top b{font-family:Rajdhani,sans-serif;font-size:24px;letter-spacing:3px} #lm-top span{font-size:12.5px;color:var(--mut)}
#lm-legend{position:absolute;left:max(18px,env(safe-area-inset-left));bottom:max(16px,env(safe-area-inset-bottom));display:flex;gap:12px;padding:9px 14px;border-radius:14px;font-size:12px;color:#cfd5e1}
#lm-legend i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:6px;vertical-align:-1px}
#lm-panel{position:absolute;right:max(18px,env(safe-area-inset-right));top:max(14px,env(safe-area-inset-top));bottom:max(16px,env(safe-area-inset-bottom));width:min(320px,44vw);border-radius:22px;padding:18px;display:flex;flex-direction:column;gap:10px;pointer-events:auto;overflow:auto}
#lm-panel .k{font-size:10.5px;font-weight:700;letter-spacing:1.6px;color:var(--teal);text-transform:uppercase}
#lm-panel h2{margin:0;font-size:22px;font-weight:800;line-height:1.15}
#lm-panel .chips{display:flex;flex-wrap:wrap;gap:6px}
#lm-panel .chip{font-size:11.5px;font-weight:600;padding:5px 10px;border-radius:999px;background:rgba(255,255,255,.07);border:1px solid var(--line)}
#lm-panel .chip.g{color:#9ff0c2;border-color:rgba(73,224,138,.35)} #lm-panel .chip.r{color:#ffb0b8;border-color:rgba(255,77,94,.35)} #lm-panel .chip.p{color:#d4c2ff;border-color:rgba(139,92,246,.45)}
#lm-panel .stats{display:grid;grid-template-columns:1fr 1fr;gap:8px}
#lm-panel .stat{background:rgba(255,255,255,.05);border-radius:12px;padding:9px 10px} #lm-panel .stat span{display:block;font-size:10.5px;color:var(--mut);font-weight:600;letter-spacing:.6px;text-transform:uppercase} #lm-panel .stat b{font-size:16px}
#lm-panel .price{font-size:32px;line-height:1} #lm-panel .price small{font-size:13px;color:var(--mut);font-family:Inter,sans-serif;font-weight:600}
#lm-panel .own{display:flex;align-items:center;gap:10px;font-size:13px}
#lm-panel .own i{width:34px;height:34px;border-radius:50%;background:linear-gradient(140deg,#f59e0b,#ef4444);display:flex;align-items:center;justify-content:center;font-style:normal;font-weight:800;color:#fff}
#lm-panel .btn{width:100%;padding:14px;font-size:15px;margin-top:auto}
#lm-panel .empty{color:var(--mut);font-size:14px;line-height:1.5;margin:auto 0;text-align:center}
#tc{position:fixed;inset:0;z-index:4;pointer-events:none}
#tc .tb{position:absolute;width:62px;height:62px;border-radius:50%;background:rgba(14,16,26,.45);border:1.5px solid rgba(255,255,255,.28);backdrop-filter:blur(6px);color:#fff;display:flex;align-items:center;justify-content:center;pointer-events:auto;font-family:Inter,sans-serif;font-size:10px;font-weight:800;letter-spacing:.6px}
#tc .tb svg{width:26px;height:26px;fill:none;stroke:#fff;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
#tc .tb.pri{background:linear-gradient(180deg,rgba(139,92,246,.85),rgba(109,62,240,.85));border-color:rgba(255,255,255,.4);box-shadow:0 6px 18px rgba(109,62,240,.45)}
#tc .tb.down{transform:scale(.92);background:rgba(255,255,255,.3)}
#tc .tb.sq{border-radius:15px;width:46px;height:46px} #tc .tb.sq svg{width:21px;height:21px} #tc .tb b{font:800 11px Rajdhani,Inter,sans-serif;letter-spacing:1px}
#tc .tb small{position:absolute;bottom:-17px;left:50%;transform:translateX(-50%);white-space:nowrap;font:700 11px Rajdhani,Inter,sans-serif;letter-spacing:.5px;color:#e9edf5;text-shadow:0 1px 3px #000}
#tc [data-tbtn=fire]{right:max(22px,env(safe-area-inset-right));bottom:40px;width:78px;height:78px}
#tc [data-tbtn=interact]{right:calc(max(22px,env(safe-area-inset-right)) + 92px);bottom:22px;width:60px;height:60px;border-color:rgba(45,224,200,.75)}
#tc [data-tbtn=jump]{right:calc(max(22px,env(safe-area-inset-right)) + 10px);bottom:134px;width:56px;height:56px}
#tc [data-tbtn=aim]{right:calc(max(22px,env(safe-area-inset-right)) + 86px);bottom:100px;width:52px;height:52px}
#tc [data-tbtn=crouch]{right:calc(max(22px,env(safe-area-inset-right)) + 164px);bottom:22px;width:48px;height:48px}
#tc [data-tbtn=reload]{right:calc(max(22px,env(safe-area-inset-right)) + 154px);bottom:84px;width:48px;height:48px}
#tcrow{position:absolute;right:max(22px,env(safe-area-inset-right));top:calc(max(14px,env(safe-area-inset-top)) + 118px);display:flex;flex-direction:row-reverse;gap:8px}
#tc #tcrow .tb{position:relative}
#tc [data-tbtn=duty]{width:62px;display:none;border-color:#ffc53d;color:#ffc53d}
#tc.duty [data-tbtn=duty]{display:flex} #tc.onduty [data-tbtn=duty]{background:rgba(255,197,61,.85);color:#0b0d14}
#tc.car [data-tbtn=crouch],#tc.car [data-tbtn=reload],#tc.car [data-tbtn=me],#tc.car [data-tbtn=swap],#tc.car [data-tbtn=aim]{display:none}
#tc.car [data-tbtn=fire] small{display:none}
.touch #wcard{display:none!important}
.touch #speedo{right:auto;left:50%;transform:translateX(-50%);bottom:max(6px,env(safe-area-inset-bottom));width:min(120px,26vh)}
.touch #prompt{pointer-events:auto;top:auto;bottom:calc(max(22px,env(safe-area-inset-bottom)) + 70px)}
.touch #prompt kbd{background:var(--teal,#2de0c8)}
#hlhud.titling #flash,#hlhud.titling #soc-tick{opacity:0!important;transition:opacity .3s}
#joy-base{position:fixed;left:0;top:0;width:124px;height:124px;border-radius:50%;border:1.5px solid rgba(255,255,255,.35);background:radial-gradient(circle,rgba(45,224,200,.12),rgba(10,12,20,.25));transform:translate(-999px,-999px);pointer-events:none;z-index:4}
#joy-knob{position:fixed;left:0;top:0;width:54px;height:54px;border-radius:50%;background:rgba(255,255,255,.85);box-shadow:0 0 0 6px rgba(45,224,200,.25);transform:translate(-999px,-999px);pointer-events:none;z-index:4}
@media (max-width:760px){.pill{height:30px;font-size:15px;padding:0 11px 0 5px}.pill .ico{width:21px;height:21px}#p-time{height:26px;font-size:11px}#p-time .num{font-size:14px}#stars svg{width:13px;height:13px}
  #toasts{width:min(250px,56vw)}.toast{padding:8px 10px;border-radius:13px}.toast .ti{flex-basis:28px;height:28px}.toast h4{font-size:12px}.toast p{font-size:11px}
  #mm{width:min(190px,42vw)}#mmhead b{font-size:14px}#mmhead span{font-size:11px}#parcel{display:none!important}
  #subs{font-size:14px;bottom:36%}#title .t{font-size:min(40px,10vw)}#title small{font-size:12px}#help{font-size:12px}
  #wcard{bottom:auto;top:calc(max(14px,env(safe-area-inset-top)) + 118px);padding:7px 11px 7px 8px}#wcard .wi{width:30px;height:30px}#wcard .num{font-size:17px}#wcard b{font-size:12px}
  #speedo{width:min(150px,36vw);right:auto;left:50%;transform:translateX(-50%);bottom:max(8px,env(safe-area-inset-bottom))}
  #call{min-width:88vw}#lm-panel{top:auto;height:52%;width:auto;left:max(12px,env(safe-area-inset-left))}}
@media (max-height:520px){#mm{width:min(200px,26vw)}#radarw{aspect-ratio:1.7}#mmhead b{font-size:13px}#mmhead span{font-size:10.5px}#vitals{margin-top:5px}
  .pill{height:28px;font-size:14px;padding:0 10px 0 4px}.pill .ico{width:20px;height:20px}.pill .ico svg{width:12px;height:12px}#p-time{height:24px;font-size:10.5px}#p-time .num{font-size:13px}
  #title{top:16%}#title .t{font-size:min(38px,8vh)}#title small{font-size:11px}#subs{font-size:13px;bottom:30%}#parcel{display:none!important}
  #wcard{padding:6px 10px 6px 7px;border-radius:14px}#wcard .wi{width:28px;height:28px}#wcard b{font-size:11.5px}#wcard .num{font-size:16px}
  #speedo{width:min(130px,32vh)}#lm-panel{width:min(300px,36vw);padding:12px;gap:7px}#lm-panel h2{font-size:17px}#lm-panel .price{font-size:24px}#lm-top span{display:none}#lm-top{padding:7px 10px}#lm-top b{font-size:18px}
  #call{min-width:min(360px,60vw);padding:7px 9px 7px 7px}#call .av{width:36px;height:36px;font-size:15px}#call button{width:36px;height:36px}
  #toasts{width:min(260px,40vw)}.toast{padding:7px 9px}.toast h4{font-size:11.5px}.toast p{font-size:10.5px}}
@media (max-width:760px),(max-height:520px){#p-me{height:28px;font-size:13px;max-width:130px;padding:0 9px 0 4px;gap:6px}#p-me .av{width:20px;height:20px;font-size:11px;border-radius:7px}#p-me .lv{font-size:14px}#nameplate b{font-size:12px}}
`;
const svg = (d: string) => `<svg viewBox="0 0 24 24"><path d="${d}"/></svg>`;
const I = {
  wallet: 'M3 7h15a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7zm0 0 12-3v3M16 13.5h2',
  bank: 'M3 10h18M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18M12 3 3 8h18z',
  star: 'M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4L2.8 9.5l6.4-.8z',
  phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2',
  hang: 'M3 14c5-5 13-5 18 0l-2.5 3-3.5-1.5V13a10 10 0 0 0-6 0v2.5L5.5 17z',
  cash: 'M3 6h18v12H3zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 9v.01M18 15v.01',
  siren: 'M7 18v-6a5 5 0 0 1 10 0v6M5 18h14v3H5zM12 3v2M4.5 6.5 6 8M19.5 6.5 18 8',
  pin: 'M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21zM12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  msg: 'M4 5h16v11H10l-5 4v-4H4z',
  land: 'M3 20h18M5 20V10l7-5 7 5v10M10 20v-5h4v5',
  gun: 'M3 9h14l2-2h2v4h-3l-1 2h-4l-1 5H8l1-5H3z',
  fist: 'M7 11V7.5a1.5 1.5 0 0 1 3 0V11m0-4a1.5 1.5 0 0 1 3 0v4m0-3.5a1.5 1.5 0 0 1 3 0V12m0-2a1.5 1.5 0 0 1 3 0v4a7 7 0 0 1-7 7h-1a6 6 0 0 1-6-6v-3a1.5 1.5 0 0 1 3 0',
  blade: 'M4 20 15 9l3-6 3 3-6 3L4 20zM7 17l-2-2',
  car: 'M5 16h14M5 16v3h3v-3m8 0v3h3v-3M3 16v-4l2-5h14l2 5v4M7 12h.01M17 12h.01',
  jump: 'M12 19V5M6 11l6-6 6 6',
  reload: 'M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5',
  aim: 'M12 3v4M12 17v4M3 12h4M17 12h4M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  swap: 'M7 7h12l-3-3M17 17H5l3 3',
  crouch: 'M12 5a2 2 0 1 0 0 .01M9 21l2-7 4 1 1 6M8 11l4-2 3 2 2 3',
  map: 'M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14',
  hand: 'M8 13V5.5a1.5 1.5 0 0 1 3 0V12m0-1.5v-6a1.5 1.5 0 0 1 3 0V12m0-5.5a1.5 1.5 0 0 1 3 0V13m0-3.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-2a6 6 0 0 1-4.6-2.2L4.2 15.6a1.6 1.6 0 0 1 2.5-2L8 15',
  me: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
};
export const APPS: [string, string, string][] = [
  ['Map', svg(I.map), 'linear-gradient(160deg,#2de0c8,#139a8a)'],
  ['Hustles', svg('M4 8h16v11H4zM9 8V5h6v3M4 13h16'), 'linear-gradient(160deg,#f6c453,#d98a12)'],
  ['Land', svg(I.land), 'linear-gradient(160deg,#a78bfa,#6d3ef0)'],
  ['Bank', svg('M3.5 7.5h17v12h-17zM3.5 7.5 15 4.5v3M15.5 13.5h3'), 'linear-gradient(160deg,#3a3f52,#151824)'],
  ['Weather', svg('M7 18h10a4 4 0 0 0 .4-8A5.5 5.5 0 0 0 6.8 11 3.5 3.5 0 0 0 7 18z'), 'linear-gradient(160deg,#7cc4ff,#3a86e0)'],
  ['Roads', svg('M12 3v4M12 10v4M12 17v4M5 21 8 3M19 21 16 3'), 'linear-gradient(160deg,#ff8a5c,#d1452c)'],
  ['Skills', svg('M4 20V10M10 20V4M16 20v-8M22 20H2M7 7l3-3 3 4 4-5'), 'linear-gradient(160deg,#ff7a9a,#d1306a)'],
  ['Contacts', svg('M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20c1.4-3.6 4.2-5.5 7.5-5.5s6.1 1.9 7.5 5.5'), 'linear-gradient(160deg,#9aa3ad,#59616b)'],
  ['Settings', svg('M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12l2-1-1-3-2 .2-1.3-1.3.2-2-3-1-1 2h-1.8l-1-2-3 1 .2 2L6 7.2 4 7l-1 3 2 1v1.8l-2 1 1 3 2-.2 1.3 1.3-.2 2 3 1 1-2h1.8l1 2 3-1-.2-2 1.3-1.3 2 .2 1-3-2-1z'), 'linear-gradient(160deg,#70757c,#3a3d42)'],
];

/** the four apps that sit in the dock (they are left out of the grid) */
const DOCK = ['Phone', 'Messages', 'Wallet', 'Map'];
/** Phone apps that systems add (society: Market, Street). They render rows into the app view; actions go to GameSystem.onAction. */
const EXT_APPS = new Map<string, { render: (c: PhoneCtx) => string; mode: 'replace' | 'append' }>();
export function registerPhoneApp(name: string, icon: string, color: string, render: (c: PhoneCtx) => string, mode: 'replace' | 'append' = 'replace') {
  if (mode === 'replace' && !APPS.some((a) => a[0] === name)) APPS.splice(Math.max(0, APPS.length - 1), 0, [name, svg(icon), color]);
  EXT_APPS.set(name, { render, mode });
}

/** Systems add phone apps here: the grid icon, a gradient and a function that returns the app's HTML rows (buttons carry data-app / data-id and come back through GameSystem.onAction). */
const APP_RENDER = new Map<string, (c: PhoneCtx, hud: LifeHud) => string>();
export function registerApp(name: string, iconPath: string, gradient: string, render: (c: PhoneCtx, hud: LifeHud) => string) {
  if (!APPS.some((a) => a[0] === name)) APPS.push([name, svg(iconPath), gradient]);
  APP_RENDER.set(name, render);
}
export interface PhoneCtx { time: string; real: string; weather: string; season: string; day: number; cash: number; bank: number; plots: { plot: Plot; price: number; owned: boolean; dist: number }[]; jobs: { id: string; title: string; pay: number; desc: string; active: boolean }[]; texts: [string, string][]; potholes: { name: string; road: string; area: string; reported: string; placed: number; source: string }[]; quality: string }
export interface ParcelInfo { id: string; title: string; area: string; owner: string; size: number; zone: string; price: number; owned: boolean; /** sold to another player (multiplayer) */ taken?: boolean; traits: [string, 'g' | 'r' | 'p' | ''][]; stats: [string, string][] }
export interface HudFrame { time: string; real: string; weather: string; temp: number; area: string; street: string; weapon: string; weaponKind: 'none' | 'melee' | 'gun'; ammo: string; mag: string; aiming: boolean; inCar: boolean; bank: number; kmh: number; gear: string; rpm: number }

const fmt = (n: number) => '₦' + Math.round(n).toLocaleString();
const initials = (s: string) => s.split(/\s+/).filter(Boolean).slice(-2).map((w) => w[0]).join('').toUpperCase();

/** spider cracks on the glass, deterministic per level */
function crackSvg(level: number) {
  let seed = 7 + level * 13; const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const lines: string[] = []; const hubs = level === 1 ? 1 : level === 2 ? 2 : 4;
  for (let h = 0; h < hubs; h++) {
    const cx = 20 + r() * 60, cy = 15 + r() * 70; const n = level === 1 ? 3 : 6 + level * 2;
    for (let i = 0; i < n; i++) {
      let x = cx, y = cy; const a0 = r() * Math.PI * 2; let d = `M${x.toFixed(1)} ${y.toFixed(1)}`; const len = (level === 1 ? 18 : 30 + level * 12) * (0.5 + r());
      for (let k = 0; k < 5; k++) { const a = a0 + (r() - 0.5) * 0.7; x += Math.cos(a) * len / 5; y += Math.sin(a) * len / 5; d += ` L${x.toFixed(1)} ${y.toFixed(1)}`; }
      lines.push(`<path d="${d}" stroke="white" stroke-opacity="${(0.55 + r() * 0.4).toFixed(2)}" stroke-width="${(0.25 + r() * 0.35).toFixed(2)}" fill="none"/>`);
    }
    if (level >= 2) lines.push(`<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${(1.5 + level).toFixed(1)}" fill="white" fill-opacity=".25"/>`);
  }
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="none">${lines.join('')}</svg>`);
}

export class LifeHud {
  root: HTMLElement; el = (id: string) => document.getElementById(id)!;
  subQueue: { who: string; text: string; secs: number }[] = []; subT = 0; titleT = 0; flashT = 0;
  shown = 0; sel = 0; phoneUp = false; appOpen: string | null = null; rowSel = 0;
  ctx: PhoneCtx | null = null;
  /** Systems draw their own phone apps: return the rows' html (same .row markup, buttons with data-app and data-id). */
  appRenderers: Record<string, (c: PhoneCtx) => string> = {};
  /** an app can handle Back itself (a chat thread goes back to the list); return true when it did */
  appBack: Record<string, () => boolean> = {};
  /** red count bubbles on app icons (unread texts, missed calls) */
  badges: Record<string, number> = {};
  onAction?: (app: string, id: string) => void;
  onBuy?: (id: string) => void;
  radarCv: HTMLCanvasElement; radarG: CanvasRenderingContext2D;
  me = { name: 'You', level: 1, id: '' };
  private npShown = false;
  private callCb: { yes: () => void; no?: () => void } | null = null; private callT = 0; private callUntil = 0;
  private parcelId = ''; private lastFrame: HudFrame | null = null;
  touch = false;
  private speedArc: SVGPathElement; private rpmArc: SVGPathElement;
  constructor(touch: boolean) {
    const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
    this.root = document.createElement('div'); document.body.appendChild(this.root);
    const tb = (id: string, icon: string, pri = false, key = '', cls = '', label = '') => `<div class="tb${pri ? ' pri' : ''}${cls ? ' ' + cls : ''}" data-tbtn="${id}"${key ? ` data-key="${key}"` : ''}>${icon ? svg(icon) : `<b>${label}</b>`}${id === 'fire' ? '<small id="tb-w"></small>' : ''}</div>`;
    this.root.innerHTML = `
<div id="hlhud">
  <div id="toasts"></div>
  <div id="call" class="gl"><div class="av" id="call-av">?</div><div class="who"><b id="call-n"></b><span id="call-l"></span></div>
    <button class="no" id="call-no" aria-label="Decline">${svg(I.hang)}</button><button class="yes" id="call-yes" aria-label="Answer">${svg(I.phone)}</button></div>
  <div id="tr">
    <div class="pills"><div class="pill gl" id="p-me"><span class="av" id="me-av">?</span><span class="nm" id="me-nm">You</span><span class="lv" id="me-lv">LV 1</span></div><div class="pill gl" id="p-bank"><span class="ico">${svg(I.bank)}</span><b class="num" id="bank">₦0</b></div>
      <div class="pill gl" id="p-cash"><span class="ico">${svg(I.wallet)}</span><b class="num" id="money">₦0</b></div></div>
    <div class="pills"><span id="flash" class="num ts"></span><div class="pill gl" id="p-time"><span class="num" id="clock">07:10</span><span id="sub2"></span></div></div>
    <div id="stars" class="gl none">${[0, 1, 2, 3, 4].map(() => svg(I.star)).join('')}</div>
  </div>
  <div id="mm"><div id="mmhead" class="ts"><b id="area"></b><span id="street"></span></div>
    <div id="radarw" class="gl"><canvas id="radar" width="540" height="348"></canvas><div id="mmdir"></div></div>
    <div id="vitals"><div class="v"><i id="hp" style="width:100%"></i></div><div class="v"><i id="ar" style="width:0%"></i></div></div></div>
  <div id="nameplate"><b id="np-n"></b><i id="np-l"></i></div>
  <div id="parcel" class="gl"></div>
  <div id="wcard" class="gl"><div class="wi" id="w-ico"></div><div><b id="w-name"></b><span class="num" id="w-ammo"></span></div></div>
  <div id="speedo"><svg viewBox="0 0 200 200">
      <defs><linearGradient id="sg" x1="0" x2="1"><stop offset="0" stop-color="#2de0c8"/><stop offset="1" stop-color="#8b5cf6"/></linearGradient></defs>
      <circle cx="100" cy="100" r="92" fill="rgba(10,12,20,.55)" stroke="rgba(255,255,255,.08)"/>
      <path d="${this.arc(100, 100, 80, -130, 130)}" stroke="rgba(255,255,255,.1)" stroke-width="10" fill="none" stroke-linecap="round"/>
      <path id="spd-arc" d="" stroke="url(#sg)" stroke-width="10" fill="none" stroke-linecap="round"/>
      <path d="${this.arc(100, 100, 66, -130, 130)}" stroke="rgba(255,255,255,.06)" stroke-width="4" fill="none" stroke-dasharray="2 6"/>
      <path id="rpm-arc" d="" stroke="#ff4d5e" stroke-width="4" fill="none" stroke-dasharray="2 6"/>
    </svg><div class="sv"><span class="num" id="kmh">0</span><small>KM/H</small></div><div class="gear num" id="gear">N</div></div>
  <div id="help" class="gl"></div><div id="subs" class="ts"></div><div id="title"><span class="t" id="title-t"></span><small id="title-s"></small><div class="bar"></div></div>
  <div id="prompt" class="gl"></div><div id="xhair"></div>
  <div id="phone"><div id="scr"><div class="wall"></div><div class="isl"></div><div class="st"><span id="ph-t"></span><i>5G <b></b></i></div><div class="big" id="ph-big"></div><div class="small" id="ph-s"></div><div class="small" id="ph-name" style="margin-top:4px;color:#7ef3df;opacity:1"></div><div id="apps"></div><div id="dock"></div><div class="home"></div>
    <div id="appview"><div class="nav"><button class="bk" id="av-bk" aria-label="Back"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>Back</button><span class="ai" id="av-ic"></span><h3 id="av-h"></h3></div><div class="list" id="av-l"></div><button class="back" id="av-back" aria-label="Home screen"></button></div><div id="ph-crack"></div></div></div>
</div>
<div id="landmap"><div id="lm-catch" style="position:absolute;inset:0;pointer-events:auto;touch-action:none;cursor:grab"></div><div id="lm-top" class="gl"><b>LANDMAP</b><span>Drag to move · scroll or pinch to zoom · tap a plot</span><button class="btn ghost" id="lm-x">Close<kbd>M</kbd></button></div>
  <div id="lm-legend" class="gl"><span><i style="background:#8b5cf6"></i>Yours</span><span><i style="background:#49e08a"></i>Vacant</span><span><i style="background:#f59e0b"></i>Unfinished</span><span><i style="background:#9ba3b4"></i>Built</span></div>
  <div id="lm-panel" class="gl"><div class="empty">Tap any plot on the map to see who owns it, what it is worth, and to buy it.</div></div></div>
${touch ? `<div id="tc">
  ${tb('fire', I.fist, true)}
  ${tb('jump', I.jump)}
  ${tb('interact', I.hand)}
  ${tb('aim', I.aim)}
  ${tb('crouch', I.crouch)}
  ${tb('reload', I.reload)}
  <div id="tcrow">${tb('swap', I.swap, false, '', 'sq')}${tb('phone', I.phone, false, '', 'sq')}${tb('map', I.land, false, '', 'sq')}${tb('me', I.me, false, 'KeyZ', 'sq')}${tb('duty', '', false, 'KeyJ', 'sq', 'DUTY')}</div>
</div><div id="joy-base"></div><div id="joy-knob"></div>` : ''}`;
    if (touch) { this.el('hlhud').classList.add('touch'); this.el('prompt').dataset.tap = 'interact'; }
    this.touch = touch;
    this.radarCv = this.el('radar') as HTMLCanvasElement; this.radarG = this.radarCv.getContext('2d')!;
    this.speedArc = this.el('spd-arc') as unknown as SVGPathElement; this.rpmArc = this.el('rpm-arc') as unknown as SVGPathElement;
    this.renderApps();
    this.el('av-back').onclick = () => this.closeApp(); this.el('av-bk').onclick = () => { const n = this.appOpen; if (n && this.appBack[n]?.()) { this.refreshApp(); return; } this.closeApp(); };
    // typing in a phone field must not drive the car or open menus: stop game keys before any other listener sees them
    addEventListener('keydown', (e) => { const t = e.target as HTMLElement | null; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') && t.closest('#appview') && e.key !== 'Enter' && e.key !== 'Escape') e.stopImmediatePropagation(); }, true);
    addEventListener('keyup', (e) => { const t = e.target as HTMLElement | null; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') && t.closest('#appview')) e.stopImmediatePropagation(); }, true);
    this.el('call-yes').onclick = () => this.answer(true); this.el('call-no').onclick = () => this.answer(false);
  }
  private arc(cx: number, cy: number, r: number, a0: number, a1: number) {
    const p = (a: number) => [cx + r * Math.sin((a * Math.PI) / 180), cy - r * Math.cos((a * Math.PI) / 180)];
    const [x0, y0] = p(a0), [x1, y1] = p(a1);
    return `M${x0.toFixed(1)} ${y0.toFixed(1)}A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`;
  }

  // ---------------------------------------------------------------- boot
  /** Progress on the loading screen (index.html markup, driven by ui/intro.ts). */
  setLoad(p: number, txt?: string) { loadScreen.setLoad(p, txt); }

  // ---------------------------------------------------------------- profile
  /** The one profile of this account: chip in the top right, name on the phone, plate above the player. */
  setProfile(name: string, level: number, id = '') {
    this.me = { name, level, id };
    const ini = (name.match(/[\p{L}\p{N}]/gu) ?? ['?']).slice(0, 2).join('').toUpperCase();
    this.el('me-av').textContent = ini; this.el('me-nm').textContent = name; this.el('me-lv').textContent = `LV ${level}`;
    this.el('np-n').textContent = name; this.el('np-l').textContent = `LV ${level}`; this.el('ph-name').textContent = name;
  }
  /** Name plate over the player's head; x, y in CSS pixels, null hides it. */
  plate(at: { x: number; y: number } | null) {
    const e = this.el('nameplate');
    if (!at) { if (this.npShown) { e.style.display = 'none'; this.npShown = false; } return; }
    if (!this.npShown) { e.style.display = 'flex'; this.npShown = true; }
    e.style.transform = `translate(${Math.round(at.x)}px,${Math.round(at.y)}px) translate(-50%,-100%)`;
  }

  // ---------------------------------------------------------------- messages
  say(who: string, text: string, secs = 3.4) { this.subQueue.push({ who, text, secs }); }
  help(html: string | null) { const h = this.el('help'); if (!html) { h.style.display = 'none'; return; } h.innerHTML = html; h.style.display = 'block'; }
  title(t: string, small?: string, secs = 4, danger = false) { this.el('title-t').textContent = t; this.el('title-s').textContent = small ?? ''; const e = this.el('title'); e.classList.add('on'); e.classList.toggle('danger', danger); this.titleT = secs; this.el('hlhud').classList.add('titling'); }
  money(d: number) { const f = this.el('flash'); f.textContent = `${d > 0 ? '+' : '-'}${fmt(Math.abs(d))}`; f.style.color = d > 0 ? 'var(--grn)' : 'var(--red)'; f.style.opacity = '1'; this.flashT = 2.2; }
  prompt(html: string | null) { const p = this.el('prompt'); if (!html) { p.style.display = 'none'; return; } if (this.touch) { const k = /<kbd>([A-Z])<\/kbd>/.exec(html)?.[1]; p.dataset.tap = !k || k === 'E' || k === 'F' ? 'interact' : `key:Key${k}`; html = html.replace(/<kbd>[A-Z]<\/kbd>/, '<kbd>TAP</kbd>'); } if (p.innerHTML !== html) p.innerHTML = html; p.style.display = 'block'; }
  /** flags on the touch controls (car, duty, onduty) so systems can show the buttons that make sense right now */
  tcFlag(flag: string, on: boolean) { document.getElementById('tc')?.classList.toggle(flag, on); }
  toast(title: string, body: string, color = 'var(--pur)', icon: keyof typeof I = 'msg', secs = 4.5) {
    const T = this.el('toasts'); const d = document.createElement('div'); d.className = 'toast gl';
    d.innerHTML = `<div class="ti" style="background:${color}">${svg(I[icon])}</div><div><h4>${title}</h4><p>${body}</p></div>`;
    T.prepend(d); while (T.children.length > 3) T.lastElementChild!.remove();
    setTimeout(() => { d.classList.add('out'); setTimeout(() => d.remove(), 450); }, secs * 1000);
  }
  /** Incoming call card. Answer with the button, Y / Enter, or gamepad A; decline with N or B. */
  private callQueue: [string, string, () => void, (() => void) | undefined, number][] = [];
  /** an incoming call card; a second call while one rings waits its turn (a player's invite must not be lost to Mama Put) */
  call(name: string, line: string, yes: () => void, no?: () => void, ringSecs = 12) {
    if (this.callCb) { if (this.callQueue.length < 4) this.callQueue.push([name, line, yes, no, ringSecs]); return; }
    ringSecs = Math.min(ringSecs, 20); this.callUntil = performance.now() + ringSecs * 1000;
    this.el('call-av').textContent = initials(name); this.el('call-n').textContent = name; this.el('call-l').textContent = line;
    this.el('call').classList.add('on'); this.callCb = { yes, no }; this.callT = ringSecs;
  }
  get ringing() { return !!this.callCb; }
  answer(yes: boolean) {
    const c = this.callCb; if (!c) return; this.callCb = null; this.el('call').classList.remove('on'); if (yes) c.yes(); else c.no?.();
    const n = this.callQueue.shift(); if (n) setTimeout(() => this.call(...n), 600);
  }
  event(e: SimEvent) {
    if (e.t === 'announce') this.title(e.title, e.sub, 4.5, e.tone === 'danger');
    if (e.t === 'cash') this.money(e.amount);
    if (e.t === 'crime' && e.kind !== 'cooled') { const st = this.el('stars'); st.classList.add('flash'); setTimeout(() => st.classList.remove('flash'), 2500); this.toast('Wahala', 'Somebody saw that. Police are on the way.', 'var(--red)', 'siren', 3.5); }
    if (e.t === 'crime' && e.kind === 'cooled') this.toast('You lost them', 'The police have stopped looking. For now.', '#22c55e', 'siren', 3.5);
  }

  // ---------------------------------------------------------------- parcel under your feet
  parcel(p: ParcelInfo | null) {
    const c = this.el('parcel');
    if (!p) { c.style.display = 'none'; this.parcelId = ''; return; }
    c.style.display = 'block';
    if (p.id === this.parcelId) return; this.parcelId = p.id;
    c.innerHTML = `<div class="k">Parcel · ${p.area}</div><h5>${p.title}</h5><div class="own"><i>${initials(p.owner)}</i>${p.owned ? 'Owned by <b>you</b>' : `Owner · <b>${p.owner}</b>`}</div>
      <div class="row"><span>Size</span><b>${Math.round(p.size)} m²</b></div><div class="row"><span>Zoning</span><b>${p.zone}</b></div>
      ${p.owned ? '' : `<div class="price num">${fmt(p.price)}</div><button class="btn" id="pc-buy" style="width:100%;margin-top:8px">View on LANDMAP<kbd>M</kbd></button>`}`;
    const b = c.querySelector('#pc-buy') as HTMLElement | null; if (b) b.onclick = () => this.onAction?.('Landmap', p.id);
  }

  // ---------------------------------------------------------------- landmap
  landmapOpen(on: boolean) { this.el('landmap').classList.toggle('on', on); this.el('hlhud').style.display = on ? 'none' : ''; }
  get landmapOn() { return this.el('landmap').classList.contains('on'); }
  landmapPanel(p: ParcelInfo | null, canAfford = true) {
    const P = this.el('lm-panel');
    if (!p) { P.innerHTML = `<div class="empty">Tap any plot on the map to see who owns it, what it is worth, and to buy it.</div>`; return; }
    P.innerHTML = `<div class="k">${p.area}</div><h2>${p.title}</h2>
      <div class="own"><i>${initials(p.owner)}</i><div><b>${p.owned ? 'You' : p.owner}</b><br><span style="color:var(--mut);font-size:12px">${p.owned ? 'Your name is on the papers' : 'Current owner'}</span></div></div>
      <div class="chips">${p.traits.map(([t, c]) => `<span class="chip ${c}">${t}</span>`).join('')}</div>
      <div class="stats">${p.stats.map(([k, v]) => `<div class="stat"><span>${k}</span><b>${v}</b></div>`).join('')}</div>
      ${p.owned ? '<div class="empty" style="margin:8px 0">This one is yours. Building comes next.</div>' : p.taken ? '<div class="empty" style="margin:8px 0">Sold. Somebody got here first.</div>' : `<div class="price num">${fmt(p.price)} <small>+ C of O</small></div>
      <button class="btn" id="lm-buy">${canAfford ? 'BUY PLOT' : 'NOT ENOUGH MONEY'}</button>`}`;
    const b = P.querySelector('#lm-buy') as HTMLElement | null; if (b) b.onclick = () => this.onBuy?.(p.id);
  }

  // ---------------------------------------------------------------- phone
  renderApps() {
    const dock = new Set(DOCK); const btn = ([n, , c]: [string, string, string], i: number) => `<button data-i="${i}" class="${i === this.sel ? 'sel' : ''}"><span class="iw">${appIcon(n, c)}${this.badges[n] ? `<u>${this.badges[n] > 9 ? '9+' : this.badges[n]}</u>` : ''}</span><em>${n}</em></button>`;
    this.el('apps').innerHTML = APPS.map((a, i) => (dock.has(a[0]) || (this.appFilter && !this.appFilter(a[0])) ? '' : btn(a, i))).join('');
    this.el('dock').innerHTML = DOCK.map((n) => { const i = APPS.findIndex((a) => a[0] === n); return i < 0 ? '' : btn(APPS[i], i); }).join('');
    for (const host of ['apps', 'dock']) [...this.el(host).children].forEach((b) => ((b as HTMLElement).onclick = () => { this.sel = +(b as HTMLElement).dataset.i!; this.openApp(); }));
  }
  /** a small phone runs fewer apps */
  appFilter: ((name: string) => boolean) | null = null;
  /** which phone is in your hand: its size, its shape and the state of its glass (0 clean to 3 shattered) */
  setDevice(d: { scale: number; tablet?: boolean; small?: boolean; crack: number; basic?: (n: string) => boolean }) {
    const ph = this.el('phone'); ph.style.setProperty('--ps', String(d.scale)); ph.classList.toggle('tab', !!d.tablet); ph.classList.toggle('small', !!d.small);
    this.appFilter = d.basic ?? null; const cr = this.el('ph-crack'); cr.style.opacity = String([0, 0.55, 0.8, 1][d.crack] ?? 0); cr.style.backgroundImage = d.crack ? `url("${crackSvg(d.crack)}")` : 'none';
    this.renderApps();
  }
  togglePhone(on?: boolean) { this.phoneUp = on ?? !this.phoneUp; this.el('phone').classList.toggle('up', this.phoneUp); document.body.classList.toggle('phone-up', this.phoneUp); if (!this.phoneUp) this.closeApp(); return this.phoneUp; }
  phoneNav(dx: number, dy: number) {
    if (this.appOpen) { const rows = this.el('av-l').querySelectorAll('.row'); if (!rows.length) return; this.rowSel = (this.rowSel + dy + rows.length) % rows.length; rows.forEach((r, i) => r.classList.toggle('sel', i === this.rowSel)); (rows[this.rowSel] as HTMLElement).scrollIntoView({ block: 'nearest' }); return; }
    this.sel = (this.sel + dx + dy * 4 + APPS.length) % APPS.length; this.renderApps();
  }
  phoneSelect() {
    if (!this.appOpen) { this.openApp(); return; }
    const rows = this.el('av-l').querySelectorAll('.row'); const b = rows[this.rowSel]?.querySelector('button') as HTMLButtonElement | null; b?.click();
  }
  phoneBack() { const n = this.appOpen; if (n && this.appBack[n]?.()) { this.refreshApp(); return; } if (n) this.closeApp(); else this.togglePhone(false); }
  openApp() {
    const [name, , color] = APPS[this.sel];
    if (name === 'Land') { this.togglePhone(false); this.onAction?.('Landmap', ''); return; }
    this.appOpen = name; this.rowSel = 0;
    this.el('appview').style.setProperty('--ac', appAccent(name, color)); this.el('av-h').textContent = name; this.el('av-ic').innerHTML = appIcon(name, color);
    this.refreshApp(); this.el('appview').style.display = 'flex';
  }
  /** open a phone app by name (from a menu in the world, e.g. "Check the books") */
  openAppByName(name: string) { const i = APPS.findIndex((a) => a[0] === name); if (i < 0) return; this.ctx = this.ctxProvider?.() ?? this.ctx; this.togglePhone(true); this.sel = i; this.renderApps(); this.openApp(); this.onPhone?.(true); }
  /** the game hands the hud a way to build the phone's context (for apps opened from the world, not the phone key) */
  ctxProvider?: () => PhoneCtx; onPhone?: (up: boolean) => void;
  refreshApp() {
    const name = this.appOpen; if (!name) return; const L = this.el('av-l'); const c = this.ctx; if (!c) return;
    const row = (b: string, s: string, btn?: [string, string, string]) => `<div class="row"><b>${b}</b>${s}${btn ? `<br><button class="btn" data-app="${btn[0]}" data-id="${btn[1]}">${btn[2]}</button>` : ''}</div>`;
    let html = '';
    if (this.appRenderers[name]) html = this.appRenderers[name](c);
    else if (name === 'Hustles') html = c.jobs.map((j) => row(`${j.title} · ${fmt(j.pay)}`, j.desc, j.active ? ['Hustles', 'cancel:' + j.id, 'Drop it'] : ['Hustles', j.id, 'Take it'])).join('') || row('Nothing now', 'Check back when the city wakes up.');
    else if (name === 'Texts') html = c.texts.map(([w, t]) => row(w, t)).join('');
    else if (name === 'Bank') html = row('Cash in hand', fmt(c.cash)) + row('Account', fmt(c.bank), ['Bank', 'deposit', 'Deposit ₦10,000']) + row('Withdraw', 'Any POS stand on the street will do. Small charge.', ['Bank', 'withdraw', 'Withdraw ₦10,000']);
    else if (name === 'Weather') html = row('Now', `${c.weather}, ${c.season}`) + row('Game time', `${c.time} · day ${c.day}`) + row('Lagos time', `${c.real} WAT`) + row('Potholes', 'Rain fills them. Sun and harmattan dry them. Drive accordingly.');
    else if (name === 'Roads') html = row('Pothole reports', 'From news reports and residents, 2023 to October 2026. Each report is snapped to the named road.') + c.potholes.map((p) => row(`${p.name}`, `${p.road} · ${p.area}<br>Reported ${p.reported} · ${p.placed} potholes placed`)).join('');
    else if (name === 'Contacts') html = row(`${this.me.name} (you)`, this.me.id ? `Account ${this.me.id}` : 'Your number') + row('Mama Put', 'Under the bridge, Oshodi') + row('Conductor Sule', 'Oshodi park') + row('Baba Landlord', 'Sells land. Asks no questions. Charges for C of O.');
    else if (name === 'Settings') html = row('Graphics', `Quality: ${c.quality}<br>Auto adapts to your device while you play. Tap to cycle Auto, High, Medium, Low. F3 shows frame stats.`, ['Settings', 'quality', 'Change']) + row('Weather', 'Cycle the weather (testing)', ['Settings', 'weather', 'Next']) + row('Time', 'Jump one hour', ['Settings', 'hour', '+1 hour']) + row('Lobby', 'Save and go back to the lobby. Change your look or your name there.', ['Settings', 'lobby', 'Back to lobby']);
    else if (EXT_APPS.get(name)?.mode === 'replace') html = EXT_APPS.get(name)!.render(c);
    else if (APP_RENDER.has(name)) html = APP_RENDER.get(name)!(c, this);
    else html = `<canvas id="pmap" width="400" height="400"></canvas>` + row('Legend', 'Teal: your route · Red dots: reported potholes · Purple: your land');
    const extra = EXT_APPS.get(name); if (extra?.mode === 'append') html += extra.render(c);
    L.innerHTML = html;
    L.querySelectorAll('button[data-app]').forEach((b) => ((b as HTMLElement).onclick = () => this.onAction?.((b as HTMLElement).dataset.app!, (b as HTMLElement).dataset.id!)));
    L.querySelectorAll('.row').forEach((r, i) => r.classList.toggle('sel', i === this.rowSel));
  }
  closeApp() { this.appOpen = null; this.el('appview').style.display = 'none'; }

  // ---------------------------------------------------------------- per frame
  update(dt: number, sim: LifeSim, s: HudFrame) {
    this.lastFrame = s;
    this.el('clock').textContent = s.time;
    this.el('sub2').textContent = `${s.weather} · ${Math.round(s.temp)}°`;
    const cash = sim.cash;
    if (this.shown !== cash) { this.shown += Math.sign(cash - this.shown) * Math.max(1, Math.round(Math.abs(cash - this.shown) * dt * 6)); if (Math.abs(cash - this.shown) < 2) this.shown = cash; }
    this.el('money').textContent = fmt(this.shown); this.el('bank').textContent = fmt(s.bank);
    const me = sim.local;
    const hp = Math.max(0, me.hp / me.maxHp); const H = this.el('hp') as HTMLElement; H.style.width = `${hp * 100}%`; H.classList.toggle('low', hp < 0.3);
    (this.el('ar') as HTMLElement).style.width = `${me.inv.armor ? me.inv.armor.hp : 0}%`;
    const st = this.el('stars'); st.classList.toggle('none', sim.wanted <= 0); [...st.children].forEach((b, i) => b.classList.toggle('on', i < sim.wanted));
    this.el('area').textContent = s.area; this.el('street').textContent = s.street;
    (this.el('xhair') as HTMLElement).style.display = s.aiming && !s.inCar ? 'block' : 'none';
    // weapon card on foot, speedo in a car
    const W = this.el('wcard') as HTMLElement, S = this.el('speedo') as HTMLElement;
    W.style.display = !s.inCar ? 'flex' : 'none'; S.style.display = s.inCar ? 'block' : 'none';
    if (this.touch) { this.tcFlag('car', !!s.inCar); const tw = document.getElementById('tb-w'); const wl = s.weaponKind === 'gun' ? `${s.weapon} ${s.mag}/${s.ammo}` : (s.weapon || 'Fists'); if (tw && tw.textContent !== wl) tw.textContent = wl; }
    if (!s.inCar) {
      this.el('w-name').textContent = s.weapon || 'Fists';
      this.el('w-ico').innerHTML = svg(s.weaponKind === 'gun' ? I.gun : s.weaponKind === 'melee' ? I.blade : I.fist);
      this.el('w-ammo').innerHTML = s.weaponKind === 'gun' ? `${s.mag} <small>/ ${s.ammo}</small>` : '';
    } else {
      this.el('kmh').textContent = String(Math.round(s.kmh)); this.el('gear').textContent = s.gear;
      const f = Math.min(1, s.kmh / 180); this.speedArc.setAttribute('d', f > 0.004 ? this.arc(100, 100, 80, -130, -130 + 260 * f) : '');
      this.rpmArc.setAttribute('d', s.rpm > 0.01 ? this.arc(100, 100, 66, -130, -130 + 260 * Math.min(1, s.rpm)) : '');
      this.rpmArc.setAttribute('stroke', s.rpm > 0.85 ? '#ff4d5e' : '#2de0c8');
    }
    this.el('ph-t').textContent = s.time; this.el('ph-big').textContent = s.time; this.el('ph-s').textContent = `${s.weather} · ${s.area}`;
    if (this.subT > 0) { this.subT -= dt; if (this.subT <= 0) this.el('subs').innerHTML = ''; }
    if (this.subT <= 0 && this.subQueue.length) { const n = this.subQueue.shift()!; this.el('subs').innerHTML = `<span class="who">${n.who}</span> ${n.text}`; this.subT = n.secs; }
    if (this.titleT > 0) { this.titleT -= dt; if (this.titleT <= 0) { this.el('title').classList.remove('on'); this.el('hlhud').classList.remove('titling'); } }
    if (this.flashT > 0) { this.flashT -= dt; if (this.flashT <= 0) this.el('flash').style.opacity = '0'; }
    if (this.callCb) { this.callT -= dt; if (this.callT <= 0 || performance.now() > this.callUntil) this.answer(false); }
  }

  /** Dark GPS minimap: rotates with the camera, roads by class, a teal route, blips, potholes, your land. */
  /** Roads are painted once into an offscreen layer and re-painted only after the player has moved well off its centre. */
  private radarCache: { cv: HTMLCanvasElement; cx: number; cz: number; n: number } | null = null;
  private roadLayer(net: RoadNet, px: number, pz: number, S: number) {
    const R = 430, size = Math.ceil(2 * R * S);
    let c = this.radarCache;
    if (!c) { const cv = document.createElement('canvas'); cv.width = cv.height = size; c = { cv, cx: 1e9, cz: 1e9, n: -1 }; this.radarCache = c; }
    if (Math.hypot(px - c.cx, pz - c.cz) > 130 || c.n !== net.lanes.length) {
      const g = c.cv.getContext('2d')!; g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, size, size); g.save(); g.translate(size / 2, size / 2); g.translate(-px * S, -pz * S);
      const done = new Set<number>(); const roads: Lane[] = [];
      for (const id of net.near(px, pz, R)) { const l = net.lanes[id]; if (done.has(l.road.id)) continue; done.add(l.road.id); roads.push(l); }
      g.lineCap = 'round'; g.lineJoin = 'round';
      for (const pass of [0, 1]) for (const major of [false, true]) {
        g.strokeStyle = pass === 0 ? 'rgba(0,0,0,.55)' : major ? '#5d6a86' : '#3a4459'; g.lineWidth = (major ? 14 : 8) + (pass === 0 ? 4 : 0);
        g.beginPath();
        for (const l of roads) { if ((l.cls <= 4) !== major) continue; const p = l.road.pts; for (let k = 0; k < p.length; k += 2) (k ? g.lineTo : g.moveTo).call(g, p[k] * S, p[k + 1] * S); }
        g.stroke();
      }
      g.restore(); c.cx = px; c.cz = pz; c.n = net.lanes.length;
    }
    return c;
  }
  drawRadar(net: RoadNet, px: number, pz: number, heading: number, blips: { x: number; z: number; c: string; r?: number }[], potholes: { x: number; z: number }[], owned: number[][], route: number[] | null = null, note: string | null = null) {
    const g = this.radarG, W = 540, H = 348, S = 1.25;
    g.save(); g.clearRect(0, 0, W, H);
    const bg = g.createRadialGradient(W / 2, H * 0.62, 20, W / 2, H * 0.62, W * 0.7); bg.addColorStop(0, '#1b2233'); bg.addColorStop(1, '#0d111b');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    g.translate(W / 2, H * 0.62); g.rotate(heading); g.translate(-px * S, -pz * S);
    for (const o of owned) { g.fillStyle = 'rgba(139,92,246,0.45)'; g.strokeStyle = '#a78bfa'; g.lineWidth = 2; g.beginPath(); for (let k = 0; k < o.length; k += 2) (k ? g.lineTo : g.moveTo).call(g, o[k] * S, o[k + 1] * S); g.closePath(); g.fill(); g.stroke(); }
    const rc = this.roadLayer(net, px, pz, S); g.drawImage(rc.cv, rc.cx * S - rc.cv.width / 2, rc.cz * S - rc.cv.height / 2);
    if (route && route.length >= 4) {
      g.strokeStyle = 'rgba(45,224,200,.25)'; g.lineWidth = 16; g.beginPath(); for (let k = 0; k < route.length; k += 2) (k ? g.lineTo : g.moveTo).call(g, route[k] * S, route[k + 1] * S); g.stroke();
      g.strokeStyle = '#2de0c8'; g.lineWidth = 6; g.stroke();
    }
    g.fillStyle = '#ff4d5e'; for (const h of potholes) { g.beginPath(); g.arc(h.x * S, h.z * S, 2.4, 0, 6.28); g.fill(); }
    for (const b of blips) { g.fillStyle = b.c; g.strokeStyle = '#0b0d14'; g.lineWidth = 3; g.beginPath(); g.arc(b.x * S, b.z * S, b.r ?? 9, 0, 6.28); g.fill(); g.stroke(); }
    g.restore();
    // off-map blips pinned to the edge
    for (const b of blips) {
      if ((b.r ?? 9) < 10) continue;
      const dx = (b.x - px) * S, dz = (b.z - pz) * S; const c = Math.cos(heading), s = Math.sin(heading);
      const x = dx * c - dz * s + W / 2, y = dx * s + dz * c + H * 0.62;
      if (x > 14 && x < W - 14 && y > 14 && y < H - 14) continue;
      const cx = Math.max(16, Math.min(W - 16, x)), cy = Math.max(16, Math.min(H - 16, y));
      g.fillStyle = b.c; g.strokeStyle = '#0b0d14'; g.lineWidth = 3; g.beginPath(); g.arc(cx, cy, 10, 0, 6.28); g.fill(); g.stroke();
    }
    // player
    g.save(); g.translate(W / 2, H * 0.62);
    g.fillStyle = 'rgba(45,224,200,.18)'; g.beginPath(); g.arc(0, 0, 26, 0, 6.28); g.fill();
    g.fillStyle = '#fff'; g.strokeStyle = '#0b0d14'; g.lineWidth = 3; g.beginPath(); g.moveTo(0, -15); g.lineTo(11, 12); g.lineTo(0, 6); g.lineTo(-11, 12); g.closePath(); g.fill(); g.stroke(); g.restore();
    if (note) { g.font = '600 15px Inter, system-ui, sans-serif'; g.textAlign = 'center'; const tw = g.measureText(note).width + 18; g.fillStyle = 'rgba(8,12,20,.78)'; g.beginPath(); g.roundRect(W / 2 - tw / 2, H - 34, tw, 24, 12); g.fill(); g.fillStyle = '#2de0c8'; g.fillText(note, W / 2, H - 17); g.textAlign = 'start'; }
    const deg = ((-heading * 180) / Math.PI + 360 * 4) % 360;
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']; this.el('mmdir').textContent = `${dirs[Math.round(deg / 45) % 8]} ${Math.round(deg)}°`;
  }
}
