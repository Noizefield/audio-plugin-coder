
(function(){
"use strict";

/* ==========================================================================
   00  UTILITIES
   ======================================================================= */
const NS = "http://www.w3.org/2000/svg";
const $  = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const TAU = Math.PI * 2;

const rootEl = document.documentElement;
let C = {};                                   /* resolved theme colours */
let cell = 8;                                 /* px per cell (1rem) */

function readTheme(){
  const cs = getComputedStyle(rootEl);
  const get = (n) => cs.getPropertyValue(n).trim();
  C = {
    plate:get("--plate"), panel:get("--panel"), panel2:get("--panel-2"), well:get("--well"),
    rule:get("--rule"), rulePanel:get("--rule-panel"), rule2:get("--rule-2"),
    track:get("--track"), soft:get("--soft"),
    ink:get("--ink"), ink2:get("--ink-2"), ink3:get("--ink-3"),
    sig:get("--sig"), sig2:get("--sig-2"), danger:get("--danger")
  };
  cell = parseFloat(cs.fontSize) || 8;
  C.mono = "\"JetBrains Mono\", ui-monospace, \"Cascadia Mono\", Menlo, Consolas, monospace";
  C.sans = "Inter, ui-sans-serif, Helvetica Neue, Arial, Segoe UI, sans-serif";
}
function rgbaOf(hex, a){
  let h = String(hex || "").trim().replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h || "fb543d", 16);
  return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")";
}

function fit(cv){
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const w = Math.max(1, cv.clientWidth), h = Math.max(1, cv.clientHeight);
  if (cv.width !== Math.round(w*dpr) || cv.height !== Math.round(h*dpr)){
    cv.width = Math.round(w*dpr); cv.height = Math.round(h*dpr);
  }
  const ctx = cv.getContext("2d");
  ctx.setTransform(dpr,0,0,dpr,0,0);
  return {ctx, w, h};
}

function fmtHz(v){
  if (v >= 10000) return [ (v/1000).toFixed(1), "kHz" ];
  if (v >= 1000)  return [ (v/1000).toFixed(2), "kHz" ];
  return [ v.toFixed(0), "Hz" ];
}
function fmtDb(v, dec){ return (v>0?"+":"") + v.toFixed(dec===undefined?1:dec); }

function hair(ctx, x1,y1,x2,y2, col){
  ctx.beginPath(); ctx.strokeStyle = col; ctx.lineWidth = 1;
  ctx.moveTo(Math.round(x1)+.5, Math.round(y1)+.5);
  ctx.lineTo(Math.round(x2)+.5, Math.round(y2)+.5); ctx.stroke();
}
function label(ctx, text, x, y, col, size, align, font){
  ctx.fillStyle = col;
  ctx.font = (size || cell*0.95) + "px " + (font || C.mono);
  ctx.textAlign = align || "left";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, y);
}
/* ==========================================================================
   01  STATE
   ======================================================================= */
const CHARS = [
  { name:"Silk",  tilt:-0.55, q:0.92 },
  { name:"Steel", tilt:0,     q:1    },
  { name:"Glass", tilt:0.55,  q:1.06 },
  { name:"Iron",  tilt:0.10,  q:1.18 }
];
const TYPES = ["LOWPASS","HIGHPASS","BANDPASS","NOTCH"];
const PATTERNS = ["BOUNCE","SIFT","TIDE","FLINT"];

const S = {
  gain:0, cutoff:1200, reso:0.71, drive:3,
  type:"LOWPASS", slope:24, char:1, keytrk:false, phase:false,
  surface:"night", anatomy:false,
  hold:false, trig:"FREE",
  bpm:120, playing:true, loop:true,
  env:{ a:12, d:240, s:55, r:480 },
  xy:{ x:0.615, y:0.335 },
  cursor:null, ghost:null,
  step:0, bar:1, stepPhase:0,
  seq:{ gate:[1,0,0,1, 0,0,1,0, 1,0,0,1, 0,1,0,0],
        value:[.2,.5,.35,.8, .3,.6,.9,.4, .25,.55,.7,.35, .85,.45,.6,.3] },
  patterns:PATTERNS.slice(), pattern:0,
  analysis:0,
  level:{ l:-60, r:-60, pl:-60, pr:-60, clip:false },
  spectrum:new Array(96).fill(0.01),
  freq:new Array(200).fill(0),
  phaseResp:new Array(200).fill(0),
  tilt:1, t:0
};
window.APC_F30 = S;

/* ==========================================================================
   02  DSP - RBJ biquad cascade, magnitude and phase
   ======================================================================= */
const FS = 48000, F_MIN = 20, F_MAX = 20000, N_PTS = 200;
const FREQS = Array.from({length:N_PTS}, (_,i) =>
  F_MIN * Math.pow(F_MAX/F_MIN, i/(N_PTS-1)));

function biquad(type, f0, Q){
  const w0 = TAU * f0 / FS, cs = Math.cos(w0), sn = Math.sin(w0);
  const alpha = sn / (2*Math.max(0.05,Q));
  let b0, b1, b2, a0, a1, a2;
  if (type === "HIGHPASS"){
    b0=(1+cs)/2; b1=-(1+cs); b2=(1+cs)/2; a0=1+alpha; a1=-2*cs; a2=1-alpha;
  } else if (type === "BANDPASS"){
    b0=alpha; b1=0; b2=-alpha; a0=1+alpha; a1=-2*cs; a2=1-alpha;
  } else if (type === "NOTCH"){
    b0=1; b1=-2*cs; b2=1; a0=1+alpha; a1=-2*cs; a2=1-alpha;
  } else {
    b0=(1-cs)/2; b1=1-cs; b2=(1-cs)/2; a0=1+alpha; a1=-2*cs; a2=1-alpha;
  }
  return { b0:b0/a0, b1:b1/a0, b2:b2/a0, a1:a1/a0, a2:a2/a0 };
}

/* Butterworth section Qs for a cascade of 1, 2 or 4 two-pole sections. */
const Q_TABLE = { 1:[0.7071], 2:[0.5412, 1.3066], 4:[0.5098, 0.6013, 0.9000, 2.5629] };

function sections(){
  const n = S.slope / 12;
  const qs = Q_TABLE[n] || Q_TABLE[2];
  const char = CHARS[S.char] || CHARS[1];
  const top = Math.max(1, qs.length);
  return qs.map((base, i) =>
    biquad(S.type, S.cutoff, clamp(base * S.reso * char.q / Math.sqrt(top), 0.1, 30)));
}

function magOf(sec, w){
  const cw=Math.cos(w), sw=Math.sin(w), c2=Math.cos(2*w), s2=Math.sin(2*w);
  const nr = sec.b0 + sec.b1*cw + sec.b2*c2;
  const ni = -(sec.b1*sw + sec.b2*s2);
  const dr = 1 + sec.a1*cw + sec.a2*c2;
  const di = -(sec.a1*sw + sec.a2*s2);
  return Math.hypot(nr,ni) / Math.max(1e-12, Math.hypot(dr,di));
}
function phOf(sec, w){
  const cw=Math.cos(w), sw=Math.sin(w), c2=Math.cos(2*w), s2=Math.sin(2*w);
  const nr = sec.b0 + sec.b1*cw + sec.b2*c2;
  const ni = -(sec.b1*sw + sec.b2*s2);
  const dr = 1 + sec.a1*cw + sec.a2*c2;
  const di = -(sec.a1*sw + sec.a2*s2);
  return Math.atan2(ni,nr) - Math.atan2(di,dr);
}

function analyse(){
  const secs = sections();
  const char = CHARS[S.char] || CHARS[1];
  for (let i=0;i<N_PTS;i++){
    const f = FREQS[i], w = TAU * f / FS;
    let m = 1, p = 0;
    for (const sec of secs){ m *= magOf(sec,w); p += phOf(sec,w); }
    S.freq[i] = 20*Math.log10(Math.max(1e-7,m)) + char.tilt * Math.log2(f/1000);
    S.phaseResp[i] = p * 180 / Math.PI;      /* unwrapped: 4 sections reach -720 deg */
  }
  S.tilt = Math.pow(10, (S.drive - 3) / 40);
}
function dbAt(f){
  const t = Math.log(clamp(f,F_MIN,F_MAX)/F_MIN) / Math.log(F_MAX/F_MIN);
  const x = t * (N_PTS-1), i = Math.floor(x);
  return lerp(S.freq[clamp(i,0,N_PTS-1)], S.freq[clamp(i+1,0,N_PTS-1)], x-i);
}
const XPOS = f => Math.log(clamp(f,F_MIN,F_MAX)/F_MIN) / Math.log(F_MAX/F_MIN);
/* ==========================================================================
   04  KNOB
   ======================================================================= */
const pt = (cx,cy,r,deg) => {
  const a = deg * Math.PI/180;
  return { x: cx + Math.sin(a)*r, y: cy - Math.cos(a)*r };
};
function arcPath(r, a0, a1){
  const p0 = pt(50,50,r,a0), p1 = pt(50,50,r,a1);
  const large = Math.abs(a1-a0) > 180 ? 1 : 0;
  const sweep = a1 >= a0 ? 1 : 0;
  return "M" + p0.x.toFixed(2) + " " + p0.y.toFixed(2) + "A" + r + " " + r +
         " 0 " + large + " " + sweep + " " + p1.x.toFixed(2) + " " + p1.y.toFixed(2);
}
function el(name, attrs){
  const n = document.createElementNS(NS, name);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  return n;
}

/* a pointer never draws a focus box; the keyboard still gets a ring */
document.addEventListener("pointerdown", () => {
  document.documentElement.dataset.pointer = "1";
}, true);
for (const ev of ["pointerup", "pointercancel", "keydown"]){
  document.addEventListener(ev, () => {
    delete document.documentElement.dataset.pointer;
  }, true);
}

function knob(wrap, opt){
  const dial = $(".dial", wrap);
  const square = document.createElement("div");
  square.className = "square";
  dial.appendChild(square);
  const svg = el("svg", { viewBox:"0 0 100 100" });
  svg.appendChild(el("path", { d:arcPath(46,-135,135), class:"k-track" }));
  const arc = el("path", { d:"", class:"k-arc" });
  svg.appendChild(arc);
  square.appendChild(svg);
  const face = document.createElement("span");
  face.className = "face";
  const ptr = document.createElement("i");
  ptr.className = "ptr";
  face.appendChild(ptr);
  square.appendChild(face);

  const valueEl = $(".kval", wrap);
  const api = { n:0, opt, dial };

  api.value = () => opt.log ? opt.min * Math.pow(opt.max/opt.min, api.n)
                            : lerp(opt.min, opt.max, api.n);
  api.paint = function(){
    const deg = -135 + 270*api.n;
    ptr.style.setProperty("--angle", deg.toFixed(2) + "deg");
    arc.setAttribute("d", api.n <= 0.004 ? "" : arcPath(46, -135, Math.max(-134,deg)));
    dial.setAttribute("aria-valuenow", api.value().toFixed(2));
    if (valueEl){
      const v = api.value();
      const nv = $(".nv", valueEl);
      const parts = opt.unit === "hz" ? fmtHz(v)
                  : opt.unit === "q"  ? [v.toFixed(2), ""]
                  : opt.unit === "db" ? [fmtDb(v,1), "dB"]
                  : [v.toFixed(1), ""];
      if (nv) nv.textContent = parts[0]; else valueEl.textContent = parts[0];
      const u = $(".u", valueEl);
      if (u) u.textContent = parts[1];
    }
  };
  api.setValue = function(v, quiet){
    api.n = clamp(opt.log ? Math.log(clamp(v,opt.min,opt.max)/opt.min)/Math.log(opt.max/opt.min)
                          : (v-opt.min)/(opt.max-opt.min), 0, 1);
    api.paint();
    if (!quiet && opt.on) opt.on(api.value());
  };
  api.setNorm = api.setValue;

  let drag = null;
  dial.addEventListener("pointerdown", (e) => {
    try { dial.setPointerCapture(e.pointerId); } catch (err) {}
    drag = { y:e.clientY, n:api.n };
    dial.focus({ preventScroll:true });
    wrap.classList.add("is-active");
    if (opt.onStart) opt.onStart();
    e.preventDefault();
  });
  dial.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const fine = e.shiftKey ? 6 : 1;
    api.n = clamp(drag.n + (drag.y - e.clientY) / (cell*20*fine), 0, 1);
    api.paint();
    if (opt.on) opt.on(api.value());
  });
  const stop = () => {
    if (drag && opt.onEnd) opt.onEnd();
    wrap.classList.remove("is-active");
    drag = null;
  };
  dial.addEventListener("pointerup", stop);
  dial.addEventListener("pointercancel", stop);
  dial.addEventListener("dblclick", () => api.setValue(opt.def));
  dial.addEventListener("wheel", (e) => {
    e.preventDefault();
    api.n = clamp(api.n + (e.deltaY < 0 ? 0.01 : -0.01), 0, 1);
    api.paint(); if (opt.on) opt.on(api.value());
  }, { passive:false });
  dial.addEventListener("keydown", (e) => {
    const k = e.key;
    let d = 0;
    if (k === "ArrowUp" || k === "ArrowRight") d = 0.01;
    if (k === "ArrowDown" || k === "ArrowLeft") d = -0.01;
    if (k === "PageUp") d = 0.1;
    if (k === "PageDown") d = -0.1;
    if (k === "Home" || k === "End"){
      api.n = k === "Home" ? 0 : 1; api.paint();
      if (opt.on) opt.on(api.value()); e.preventDefault(); return;
    }
    if (d){ e.preventDefault(); api.n = clamp(api.n + d, 0, 1); api.paint();
            if (opt.on) opt.on(api.value()); }
  });
  return api;
}
/* ==========================================================================
   05  SLIDER
   ======================================================================= */
function slider(wrap, opt){
  const track = $(".track", wrap);
  const thumb = $(".thumb", wrap), fill = $(".fill", wrap), nv = $(".nv", wrap);
  const ticksEl = $(".ticks", wrap);
  const api = { n:0, opt };
  if (ticksEl){
    for (let i=0;i<=4;i++){
      const t = document.createElement("i");
      if (i % 2 === 0) t.className = "maj";
      t.style.left = (i*25) + "%";
      ticksEl.appendChild(t);
    }
  }
  api.value = () => opt.log ? opt.min * Math.pow(opt.max/opt.min, api.n)
                            : lerp(opt.min, opt.max, api.n);
  api.paint = function(){
    thumb.style.left = (api.n*100) + "%";
    fill.style.width = (api.n*100) + "%";
    if (nv) nv.textContent = opt.fmt ? opt.fmt(api.value()) : Math.round(api.value());
    track.setAttribute("aria-valuenow", api.value().toFixed(2));
  };
  api.setNorm = function(n, quiet){
    api.n = clamp(n,0,1); api.paint();
    if (!quiet && opt.on) opt.on(api.value());
  };
  api.setValue = function(v, quiet){
    const n = opt.log
      ? Math.log(clamp(v,opt.min,opt.max)/opt.min)/Math.log(opt.max/opt.min)
      : (v-opt.min)/(opt.max-opt.min);
    api.setNorm(n, quiet);
  };

  let drag = false;
  const at = (e) => {
    const r = track.getBoundingClientRect();
    api.n = clamp((e.clientX - r.left)/Math.max(1,r.width), 0, 1);
    api.paint(); if (opt.on) opt.on(api.value());
  };
  track.addEventListener("pointerdown", (e) => {
    try { track.setPointerCapture(e.pointerId); } catch (err) {} drag = true;
    wrap.classList.add("is-active");
    track.focus({preventScroll:true}); at(e); e.preventDefault();
  });
  track.addEventListener("pointermove", (e) => { if (drag) at(e); });
  track.addEventListener("pointerup", () => { drag = false; wrap.classList.remove("is-active"); });
  track.addEventListener("pointercancel", () => { drag = false; wrap.classList.remove("is-active"); });
  track.addEventListener("dblclick", () => api.setValue(opt.def));
  track.addEventListener("wheel", (e) => {
    e.preventDefault(); api.setNorm(api.n + (e.deltaY < 0 ? 0.02 : -0.02));
  }, { passive:false });
  track.addEventListener("keydown", (e) => {
    let d = 0;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") d = e.shiftKey ? 0.1 : 0.02;
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") d = e.shiftKey ? -0.1 : -0.02;
    if (d){ e.preventDefault(); api.setNorm(api.n + d); }
  });
  return api;
}
/* ==========================================================================
   06  GRAPH (magnitude / phase)
   ======================================================================= */
const graphCv = $("#graph"), specCv = $("#spec"), envCv = $("#env"),
      seqCv = $("#seq"), xyCv = $("#xy"), meterCv = $("#meter"),
      waveCv = $("#waveform"), scopeCv = $("#scope");
const measureEl = $("#measure");
const G = { x0:0, y0:0, w:1, h:1 };

function phaseAt(f){
  const t = Math.log(clamp(f,F_MIN,F_MAX)/F_MIN)/Math.log(F_MAX/F_MIN);
  const x = t*(N_PTS-1), i = Math.floor(x);
  return lerp(S.phaseResp[clamp(i,0,N_PTS-1)], S.phaseResp[clamp(i+1,0,N_PTS-1)], x-i);
}

function drawGraph(){
  const {ctx, w, h} = fit(graphCv);
  const u = cell;
  const padL = u*1.2, padR = u*2.6, padT = u*1.4, padB = u*2.2;
  const x0 = padL, y0 = padT, gw = Math.max(1, w - padL - padR), gh = Math.max(1, h - padT - padB);
  G.x0 = x0; G.y0 = y0; G.w = gw; G.h = gh;

  const phase = S.mode === "phase";
  const pSpan = 180 * (S.slope / 12);
  const yMin = phase ? -pSpan : -36, yMax = phase ? 0 : 12;
  const yOf = (v) => y0 + gh - ((v - yMin)/(yMax - yMin))*gh;
  const xOf = (f) => x0 + XPOS(f)*gw;

  ctx.clearRect(0,0,w,h);

  /* horizontal scale, labelled on the right so the curve starts clean */
  const vTicks = phase
    ? [-pSpan, -pSpan*0.75, -pSpan*0.5, -pSpan*0.25, 0]
    : [-36,-24,-12,0,12];
  for (const v of vTicks){
    const y = Math.round(yOf(v))+.5;
    hair(ctx, x0, y, x0+gw, y, v === 0 ? C.rule : C.rule2);
    label(ctx, (v>0?"+":"") + v, x0+gw+u*0.55, y, C.ink3, u*0.9, "left");
  }
  /* three interior rules, five labels: enough to read, calm enough to look at */
  for (const f of [100, 1000, 10000]){
    const x = Math.round(xOf(f))+.5;
    hair(ctx, x, y0, x, y0+gh, C.rule2);
  }
  for (const f of [20, 100, 1000, 10000, 20000]){
    const x = xOf(f);
    label(ctx, f >= 1000 ? (f/1000)+"k" : String(f), x, y0+gh+u*1.05, C.ink3, u*0.9,
      f === 20 ? "left" : f === 20000 ? "right" : "center");
  }

  const curve = phase ? S.phaseResp : S.freq;
  const path = (arr) => {
    ctx.beginPath();
    for (let i=0;i<N_PTS;i++){
      const x = x0 + (i/(N_PTS-1))*gw;
      const y = yOf(arr[i]);            /* unclamped: the clip does the framing */
      if (i === 0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    }
  };

  /* the response, clipped to the plot box so the roll-off leaves the frame */
  ctx.save();
  ctx.beginPath(); ctx.rect(x0, y0, gw, gh+1); ctx.clip();

  /* while a control is being dragged, the state it started from stays visible */
  if (!phase && S.ghost && S.ghost.length === N_PTS){
    path(S.ghost);
    ctx.save();
    ctx.setLineDash([u*0.26, u*0.3]);
    ctx.strokeStyle = rgbaOf(C.soft, 0.6);
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }

  if (!phase){
    path(curve);
    ctx.lineTo(x0+gw, y0+gh); ctx.lineTo(x0, y0+gh); ctx.closePath();
    const grad = ctx.createLinearGradient(0, y0, 0, y0+gh);
    grad.addColorStop(0, rgbaOf(C.sig, 0.15));
    grad.addColorStop(0.6, rgbaOf(C.sig, 0.05));
    grad.addColorStop(1, rgbaOf(C.sig, 0));
    ctx.fillStyle = grad; ctx.fill();
  }
  path(curve);
  ctx.strokeStyle = C.sig;
  ctx.lineWidth = Math.max(1.4, u*0.16);
  ctx.lineJoin = "round"; ctx.lineCap = "round"; ctx.stroke();
  ctx.restore();

  if (!phase){
    const cx = xOf(S.cutoff), cy = yOf(clamp(dbAt(S.cutoff), yMin, yMax));
    ctx.save(); ctx.setLineDash([u*0.28, u*0.38]);
    ctx.beginPath(); ctx.moveTo(Math.round(cx)+.5, y0); ctx.lineTo(Math.round(cx)+.5, y0+gh);
    ctx.strokeStyle = C.rule; ctx.lineWidth = 1; ctx.stroke(); ctx.restore();
    ctx.beginPath(); ctx.arc(cx, cy, u*0.9, 0, TAU);
    ctx.fillStyle = C.panel; ctx.fill();
    ctx.strokeStyle = C.sig; ctx.lineWidth = Math.max(1.2, u*0.14); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, u*0.3, 0, TAU);
    ctx.fillStyle = C.sig; ctx.fill();
  }

  if (S.cursor !== null && S.cursor >= x0 && S.cursor <= x0+gw){
    const t = (S.cursor - x0)/gw;
    const f = F_MIN * Math.pow(F_MAX/F_MIN, t);
    const val = phase ? phaseAt(f) : dbAt(f);
    const y = yOf(clamp(val, yMin, yMax));
    ctx.save(); ctx.setLineDash([u*0.35, u*0.35]);
    ctx.beginPath(); ctx.moveTo(Math.round(S.cursor)+.5, y0);
    ctx.lineTo(Math.round(S.cursor)+.5, y0+gh);
    ctx.strokeStyle = C.ink3; ctx.lineWidth = 1; ctx.stroke(); ctx.restore();
    ctx.beginPath(); ctx.arc(S.cursor, y, u*0.28, 0, TAU);
    ctx.fillStyle = C.ink; ctx.fill();
    const hz = fmtHz(f);
    measureEl.innerHTML = "<b>" + hz[0] + " " + hz[1] + "</b> / <b>" +
      (phase ? val.toFixed(0) + " deg" : fmtDb(val) + " dB") + "</b>";
  } else {
    measureEl.innerHTML = "<b>--</b> / <b>--</b>";
  }
  hair(ctx, x0, y0+gh, x0+gw, y0+gh, C.rule);
}
/* ==========================================================================
   07  SPECTRUM / WAVEFORM / SCOPE
   ======================================================================= */
const BINS = 96;
function drawSpectrum(){
  const {ctx, w, h} = fit(specCv);
  const u = cell;
  ctx.clearRect(0,0,w,h);
  const padL = u*0.7, padR = u*0.9, padT = u*0.5, padB = u*1.7;
  const x0 = padL, gw = Math.max(1, w - padL - padR);
  const yBot = h - padB, gy = Math.max(1, yBot - padT);

  /* one level per log bin: the filter shapes the noise floor */
  const lvl = [];
  let prev = -54;
  for (let i=0;i<BINS;i++){
    const f = F_MIN * Math.pow(F_MAX/F_MIN, i/(BINS-1));
    const target = (-20 - 4.4*Math.log2(f/1000)) + dbAt(f)*0.9;
    const wob = Math.sin(S.t*0.0011 + i*0.9)*1.6 + Math.sin(S.t*0.00043 + i*0.37)*2.0;
    const raw = clamp(target + wob, -84, 1);
    prev = prev*0.46 + raw*0.54;
    lvl.push(clamp((prev + 84)/84, 0, 1));
  }

  for (const k of [0.33, 0.66]){
    const y = Math.round(yBot - gy*k)+.5;
    hair(ctx, x0, y, x0+gw, y, C.rule2);
  }

  /* bars: narrow stem, quiet body, bright cap - reads as a measurement */
  const slot = gw / BINS;
  const bw = Math.max(1, Math.round(slot*0.62));
  const capH = Math.max(1, Math.round(u*0.14));
  for (let i=0;i<BINS;i++){
    const x = Math.round(x0 + i*slot);
    const bh = Math.max(1, Math.round(lvl[i]*gy));
    const y = Math.round(yBot - bh);
    ctx.fillStyle = rgbaOf(C.sig2, 0.30 + lvl[i]*0.42);
    ctx.fillRect(x, y, bw, bh);
    ctx.fillStyle = rgbaOf(C.sig2, 0.92);
    ctx.fillRect(x, y, bw, Math.min(capH, bh));
  }

  /* cutoff marker + scale under the bars */
  const cx = Math.round(x0 + (Math.log(S.cutoff/F_MIN)/Math.log(F_MAX/F_MIN))*gw)+.5;
  ctx.save();
  ctx.setLineDash([u*0.22, u*0.28]);
  hair(ctx, cx, padT, cx, yBot, C.rule);
  ctx.restore();
  for (const f of [20, 100, 1000, 10000, 20000]){
    const x = x0 + (Math.log(f/F_MIN)/Math.log(F_MAX/F_MIN))*gw;
    label(ctx, f >= 1000 ? (f/1000)+"k" : String(f), x, yBot+u*0.9, C.ink3, u*0.82,
      f === 20 ? "left" : f === 20000 ? "right" : "center");
  }
  hair(ctx, x0, yBot+.5, x0+gw, yBot+.5, C.rule);
}

function waveSample(ph){
  const s = ((ph % 1) * 2) - 1;                       /* saw */
  return s*0.86 + Math.sin(ph*TAU*2)*0.1 + Math.sin(ph*TAU*3)*0.04;
}
function drawWave(){
  const {ctx, w, h} = fit(waveCv);
  const u = cell;
  ctx.clearRect(0,0,w,h);
  const mid = h/2;
  hair(ctx, 0, Math.round(mid)+.5, w, Math.round(mid)+.5, C.rule);

  /* a real waveform view: many cycles, so the trace reads as a signal band */
  const amp = clamp(Math.pow(10, S.gain/20), 0.02, 2.2) * h*0.42 * (S.playing ? 1 : 0.28);
  const cycles = 16;
  const ph0 = (S.t * 0.00035) % 1;
  ctx.beginPath();
  const step = Math.max(1, Math.round(u*0.14));
  for (let x=0; x<=w; x+=step){
    const ph = ph0 + (x/w)*cycles;
    const y = mid - waveSample(ph) * amp * (S.phase ? -1 : 1);
    if (x === 0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  }
  ctx.strokeStyle = rgbaOf(C.ink, 0.78);
  ctx.lineWidth = Math.max(1, u*0.11);
  ctx.lineJoin = "round";
  ctx.stroke();

  /* edge fades: the view is a window, not a box */
  const fade = ctx.createLinearGradient(0, 0, w, 0);
  fade.addColorStop(0, rgbaOf(C.well, 1));
  fade.addColorStop(0.06, rgbaOf(C.well, 0));
  fade.addColorStop(0.94, rgbaOf(C.well, 0));
  fade.addColorStop(1, rgbaOf(C.well, 1));
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, w, h);
}

function scopeSample(ph){
  const bright = clamp(Math.log2(S.cutoff/200)/6, 0, 1);
  return Math.sin(ph*TAU)*0.6 + Math.sin(ph*TAU*2)*0.26*bright
       + Math.sin(ph*TAU*3)*0.16*bright + Math.sin(ph*TAU*5)*0.09*bright;
}
function drawScope(){
  const {ctx, w, h} = fit(scopeCv);
  const u = cell;
  ctx.clearRect(0,0,w,h);
  const cx = w/2, cy = h/2;
  const R = Math.min(w*0.42, h*0.44);

  /* goniometer lattice: unity + half circle, L/R axes, M/S diagonals */
  ctx.strokeStyle = C.rule2; ctx.lineWidth = 1;
  for (const r of [R, R*0.5]){ ctx.beginPath(); ctx.arc(cx,cy,r,0,TAU); ctx.stroke(); }
  ctx.save();
  ctx.strokeStyle = C.rule2; ctx.setLineDash([u*0.26, u*0.34]);
  ctx.beginPath();
  ctx.moveTo(cx-R*0.71, cy-R*0.71); ctx.lineTo(cx+R*0.71, cy+R*0.71);
  ctx.moveTo(cx+R*0.71, cy-R*0.71); ctx.lineTo(cx-R*0.71, cy+R*0.71);
  ctx.stroke(); ctx.restore();
  hair(ctx, cx-R, cy, cx+R, cy, C.rule);
  hair(ctx, cx, cy-R, cx, cy+R, C.rule2);

  /* the trace: L against R, rotated so mono sits on the vertical axis */
  const amp = R*1.32 * clamp(Math.pow(10, S.gain/20), 0.1, 1.8);
  const ph0 = (S.t * 0.0007) % 1;
  const skew = S.routing === "Mono" ? 0 : 0.018;
  ctx.beginPath();
  for (let i=0;i<=140;i++){
    const ph = ph0 + i/140;
    const l = scopeSample(ph), r = scopeSample(ph + skew);
    const x = cx + (l-r)*0.7071*amp;
    const y = cy - (l+r)*0.7071*amp;
    if (i === 0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  }
  ctx.strokeStyle = C.sig;
  ctx.lineWidth = Math.max(1, u*0.12);
  ctx.lineJoin = "round";
  ctx.stroke();

  if (S.trig === "RISE"){
    ctx.beginPath(); ctx.arc(cx, cy, u*0.22, 0, TAU);
    ctx.fillStyle = C.sig; ctx.fill();
  }
}
/* ==========================================================================
   08  METER / ENVELOPE / SEQUENCER / XY
   ======================================================================= */
function drawMeter(){
  const {ctx, w, h} = fit(meterCv);
  const u = cell;
  ctx.clearRect(0,0,w,h);
  const padL = u*1.5, padR = u*0.3;
  const bw = Math.max(2, w - padL - padR);
  const toX = (db) => padL + clamp((db + 60)/60, 0, 1)*bw;
  const bh = Math.max(4, h*0.15);

  /* squared bars, two colour zones: sage up to -6 dB, red from -6 to 0 */
  const rows = [
    { v:S.level.l, tag:"L", y:h*0.34 },
    { v:S.level.r, tag:"R", y:h*0.72 }
  ];
  for (const r of rows){
    const y = r.y - bh/2;
    ctx.fillStyle = C.track;
    ctx.fillRect(padL, y, bw, bh);
    /* a faint zone scale on the track, then the fill on top of it */
    ctx.fillStyle = rgbaOf(C.sig2, 0.07);
    ctx.fillRect(padL, y, toX(-6)-padL, bh);
    ctx.fillStyle = rgbaOf(C.danger, 0.10);
    ctx.fillRect(toX(-6), y, padL+bw-toX(-6), bh);
    hair(ctx, Math.round(toX(-6))+.5, y-1, Math.round(toX(-6))+.5, y+bh+1, rgbaOf(C.danger, 0.55));

    const greenEnd = Math.min(r.v, -6);
    if (greenEnd > -60){
      ctx.fillStyle = C.sig2;
      ctx.fillRect(toX(-60), y, Math.max(0, toX(greenEnd)-toX(-60)), bh);
    }
    if (r.v > -6){
      ctx.fillStyle = C.danger;
      ctx.fillRect(toX(-6), y, Math.max(0, toX(r.v)-toX(-6)), bh);
    }
    label(ctx, r.tag, padL-u*0.55, r.y, C.ink3, u*0.92, "right");
  }
  for (const db of [-48, -24, -12, -6]){
    const x = Math.round(toX(db))+.5;
    hair(ctx, x, h*0.84, x, h*0.92, C.rule);
  }
}

function drawEnv(){
  const {ctx, w, h} = fit(envCv);
  const u = cell;
  ctx.clearRect(0,0,w,h);
  const x0 = u*0.4, x1 = w - u*0.4, yb = h - u*0.45, yt = u*0.45;
  hair(ctx, x0, yb+.5, x1, yb+.5, C.rule2);

  const A = Math.sqrt(S.env.a), D = Math.sqrt(S.env.d), R = Math.sqrt(S.env.r);
  const hold = (A + D + R) * 0.35 + 1;
  const span = A + D + hold + R;
  const xa = x0 + (A/span)*(x1-x0);
  const xd = x0 + ((A+D)/span)*(x1-x0);
  const xs = x0 + ((A+D+hold)/span)*(x1-x0);
  const xe = x1;
  const ys = yb - (S.env.s/100)*(yb-yt);

  ctx.beginPath();
  ctx.moveTo(x0, yb); ctx.lineTo(xa, yt); ctx.lineTo(xd, ys);
  ctx.lineTo(xs, ys); ctx.lineTo(xe, yb);
  ctx.lineTo(x0, yb); ctx.closePath();
  ctx.fillStyle = rgbaOf(C.sig, 0.14);
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(x0, yb); ctx.lineTo(xa, yt); ctx.lineTo(xd, ys);
  ctx.lineTo(xs, ys); ctx.lineTo(xe, yb);
  ctx.strokeStyle = C.sig; ctx.lineWidth = Math.max(1, u*0.16); ctx.stroke();

  for (const p of [[xa,yt],[xd,ys],[xs,ys]]){
    ctx.beginPath(); ctx.arc(p[0], p[1], Math.max(1.4, u*0.22), 0, TAU);
    ctx.fillStyle = C.ink; ctx.fill();
  }
}

function rr(ctx, x, y, w, h, r){
  const rad = Math.max(0, Math.min(r, w/2, h/2));
  ctx.beginPath();
  ctx.moveTo(x+rad, y);
  ctx.lineTo(x+w-rad, y); ctx.quadraticCurveTo(x+w, y, x+w, y+rad);
  ctx.lineTo(x+w, y+h-rad); ctx.quadraticCurveTo(x+w, y+h, x+w-rad, y+h);
  ctx.lineTo(x+rad, y+h); ctx.quadraticCurveTo(x, y+h, x, y+h-rad);
  ctx.lineTo(x, y+rad); ctx.quadraticCurveTo(x, y, x+rad, y);
  ctx.closePath();
}
function drawSeq(){
  const {ctx, w, h} = fit(seqCv);
  const u = cell;
  ctx.clearRect(0,0,w,h);

  /* 16 fader columns: a slot, a bar from the bottom, and a 2px cap line on top */
  const n = 16;
  const gap = Math.max(2, u*0.26);
  const colW = (w - gap*(n-1)) / n;
  const numH = u*1.1;
  const laneH = h - numH;

  for (let i=0;i<n;i++){
    const x = i*(colW+gap);
    const beat = i % 4 === 0;
    const active = (i === S.step && S.playing);

    rr(ctx, x, 0, colW, laneH - u*0.1, 1);
    ctx.fillStyle = active ? rgbaOf(C.sig, 0.10) : C.panel2;
    ctx.fill();

    const v = clamp(S.seq.value[i], 0, 1);
    const bh = Math.max(2, v*(laneH - u*0.35));
    const y = laneH - u*0.1 - bh;

    rr(ctx, x, y, colW, bh, 0);
    ctx.fillStyle = active ? rgbaOf(C.sig, 0.18)
                  : beat ? rgbaOf(C.ink, 0.19) : rgbaOf(C.ink, 0.12);
    ctx.fill();

    /* a 1px edge instead of a cap bar: the fader ends with a line, not a lid */
    ctx.fillStyle = active ? C.sig : rgbaOf(C.ink, 0.32);
    ctx.fillRect(x, y, colW, 1);

    label(ctx, String(i+1), x + colW/2, laneH + numH*0.5,
      active ? C.ink : beat ? C.ink2 : C.ink3, u*0.82, "center");
  }
}

const xyTrail = [];
function drawXY(){
  const {ctx, w, h} = fit(xyCv);
  const u = cell;
  ctx.clearRect(0,0,w,h);
  for (let i=1;i<4;i++){
    hair(ctx, Math.round(w*i/4)+.5, 0, Math.round(w*i/4)+.5, h, C.rule);
    hair(ctx, 0, Math.round(h*i/4)+.5, w, Math.round(h*i/4)+.5, C.rule);
  }
  ctx.save(); ctx.setLineDash([u*0.35, u*0.45]);
  hair(ctx, Math.round(w/2)+.5, 0, Math.round(w/2)+.5, h, C.rule2);
  hair(ctx, 0, Math.round(h/2)+.5, w, Math.round(h/2)+.5, C.rule2);
  ctx.restore();

  const px = w*S.xy.x, py = h*S.xy.y;
  xyTrail.forEach((p, i) => {
    const a = (i+1)/xyTrail.length * 0.5;
    ctx.beginPath(); ctx.arc(p.x*w, p.y*h, Math.max(1, u*0.16), 0, TAU);
    ctx.fillStyle = "rgba(237,121,65," + a.toFixed(2) + ")"; ctx.fill();
  });
  /* projection ticks on the frame */
  hair(ctx, Math.round(px)+.5, 0, Math.round(px)+.5, u*0.4, C.sig);
  hair(ctx, 0, Math.round(py)+.5, u*0.4, Math.round(py)+.5, C.sig);
  ctx.beginPath(); ctx.arc(px, py, u*0.95, 0, TAU);
  ctx.strokeStyle = C.sig; ctx.lineWidth = Math.max(1, u*0.13); ctx.stroke();
  ctx.beginPath(); ctx.arc(px, py, u*0.34, 0, TAU);
  ctx.fillStyle = C.sig; ctx.fill();

  const f = fmtHz(S.cutoff);
  label(ctx, "X " + f[0] + " " + f[1], u*0.5, h - u*0.55, C.ink3, u*0.9, "left");
  label(ctx, "Y " + S.xy.y.toFixed(2), w - u*0.5, h - u*0.55, C.ink3, u*0.9, "right");
}
/* ==========================================================================
   09  UI WIRING
   ======================================================================= */
const plateEl = $("#plate");

const K = {};
K.cutoff = knob($("#kn-cutoff"), { min:20, max:20000, log:true, def:1200, unit:"hz",
  onStart(){ S.ghost = S.freq.slice(); drawGraph(); },
  onEnd(){ S.ghost = null; drawGraph(); },
  on(){ drawParams(); } });
K.reso = knob($("#kn-reso"), { min:0.5, max:14, def:2.4, unit:"q", ticks:21,
  onStart(){ S.ghost = S.freq.slice(); drawGraph(); },
  onEnd(){ S.ghost = null; drawGraph(); },
  on(){ drawParams(); } });
K.drive = knob($("#kn-drive"), { min:0, max:24, def:3, unit:"db", ticks:21,
  on(){ drawParams(); } });

const SL = {};
SL.gain = slider($("#sl-gain"), { min:-24, max:24, def:0, fmt:(v)=>fmtDb(v,1) });
SL.a = slider($("#sl-a"), { min:1, max:2000, def:12, log:true, fmt:(v)=>Math.round(v) });
SL.d = slider($("#sl-d"), { min:1, max:2000, def:240, log:true, fmt:(v)=>Math.round(v) });
SL.s = slider($("#sl-s"), { min:0, max:100, def:55, fmt:(v)=>Math.round(v) });
SL.r = slider($("#sl-r"), { min:1, max:4000, def:480, log:true, fmt:(v)=>Math.round(v) });

function drawParams(){
  S.cutoff = K.cutoff.value();
  S.reso = K.reso.value();
  S.drive = K.drive.value();
  S.xy.x = XPOS(S.cutoff);
  S.xy.y = 1 - Math.log(S.reso/0.5) / Math.log(14/0.5);
  analyse();
  drawGraph();
  drawXY();
  const f = fmtHz(S.cutoff);
  const fc = $("#ro-fc"), uEl = fc && fc.nextElementSibling;
  if (fc) fc.textContent = f[0];
  if (uEl) uEl.textContent = f[1];
  const rq = $("#ro-q"); if (rq) rq.textContent = S.reso.toFixed(2);
  const lv = $("#ro-lv"); if (lv) lv.textContent = fmtDb(dbAt(S.cutoff), 1);
}
function applyXY(fromPad){
  S.cutoff = 20 * Math.pow(1000, S.xy.x);
  S.reso = 0.5 * Math.pow(28, 1 - S.xy.y);
  if (fromPad){
    K.cutoff.setValue(S.cutoff, true);
    K.reso.setValue(S.reso, true);
  }
  analyse(); drawGraph(); drawXY();
  const f = fmtHz(S.cutoff);
  const fc = $("#ro-fc"); if (fc) fc.textContent = f[0];
  if (fc && fc.nextElementSibling) fc.nextElementSibling.textContent = f[1];
  const rq = $("#ro-q"); if (rq) rq.textContent = S.reso.toFixed(2);
}

/* segmented / tabs ------------------------------------------------------- */
function wireSeg(el, onPick){
  const btns = $$("button", el);
  btns.forEach((b) => b.addEventListener("click", () => {
    btns.forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    if (onPick) onPick(b, btns.indexOf(b));
  }));
  return { btns, pick(i){ btns[i].click(); } };
}
wireSeg($("#seg-ab"));
wireSeg($("#seg-surface"), (b) => setSurface(b.dataset.surfaceSet));
wireSeg($("#seg-trig"), (b) => { S.trig = b.textContent.trim().toUpperCase(); drawScope(); });
wireSeg($("#seg-slope"), (b) => {
  S.slope = parseInt(b.textContent, 10);
  const rs = $("#ro-slope"); if (rs) rs.textContent = String(S.slope);
  analyse(); drawGraph();
});

const tabs = $$("#tabs button");
tabs.forEach((t) => t.addEventListener("click", () => {
  tabs.forEach((x) => x.setAttribute("aria-selected", String(x === t)));
  S.mode = t.dataset.mode;
  drawGraph();
}));
S.mode = "response";

/* selector --------------------------------------------------------------- */
const selBtn = { prev:$("#sel-char .prev"), next:$("#sel-char .next") };
function stepChar(d){
  S.char = (S.char + d + CHARS.length) % CHARS.length;
  $("#sel-char-v").textContent = CHARS[S.char].name;
  analyse(); drawGraph();
}
selBtn.prev.addEventListener("click", () => stepChar(-1));
selBtn.next.addEventListener("click", () => stepChar(1));

/* toggles ---------------------------------------------------------------- */
function wireToggle(el, key, after){
  const flip = () => {
    S[key] = !S[key];
    el.setAttribute("aria-checked", String(S[key]));
    if (after) after(S[key]);
  };
  el.addEventListener("click", flip);
  el.addEventListener("keydown", (e) => {
    if (e.key === " " || e.key === "Enter"){ e.preventDefault(); flip(); }
  });
  return { set(v){ S[key] = v; el.setAttribute("aria-checked", String(v)); } };
}
wireToggle($("#tg-phase"), "phase", drawWave);
wireToggle($("#tg-keytrk"), "keytrk");

/* checkbox --------------------------------------------------------------- */
const chk = $("#chk-hold");
function flipHold(){
  S.hold = !S.hold;
  chk.setAttribute("aria-checked", String(S.hold));
}
chk.addEventListener("click", flipHold);
chk.addEventListener("keydown", (e) => {
  if (e.key === " " || e.key === "Enter"){ e.preventDefault(); flipHold(); }
});

/* radio ------------------------------------------------------------------ */
const radios = $$("#radio-mode button");
radios.forEach((b) => b.addEventListener("click", () => {
  radios.forEach((x) => x.setAttribute("aria-checked", String(x === b)));
  S.routing = b.textContent.trim();
}));
radios.forEach((b, i) => b.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown" || e.key === "ArrowUp"){
    e.preventDefault();
    const n = radios[(i + (e.key === "ArrowDown" ? 1 : -1) + radios.length) % radios.length];
    n.click(); n.focus();
  }
}));
/* ==========================================================================
   10  POPUPS (dropdown listbox / menu)
   ======================================================================= */
let popNode = null, popAnchor = null;
function closePop(){
  if (popNode){ popNode.remove(); popNode = null; }
  if (popAnchor){ popAnchor.setAttribute("aria-expanded", "false"); popAnchor = null; }
}
function openPop(anchor, items, opts){
  const same = popAnchor === anchor;
  closePop();
  if (same) return;
  opts = opts || {};
  const pr = plateEl.getBoundingClientRect(), ar = anchor.getBoundingClientRect();
  const node = document.createElement("div");
  node.className = "pop";
  node.setAttribute("role", opts.role || "listbox");
  if (opts.header){
    const h = document.createElement("div");
    h.className = "hd"; h.textContent = opts.header;
    node.appendChild(h);
  }
  items.forEach((it) => {
    if (it === "-"){
      const s = document.createElement("div"); s.className = "sep"; node.appendChild(s); return;
    }
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("role", opts.role === "menu" ? "menuitem" : "option");
    if (it.checked !== undefined){
      b.setAttribute("aria-checked", String(!!it.checked));
      const mk = document.createElement("span"); mk.className = "mk"; b.appendChild(mk);
    }
    const sp = document.createElement("span"); sp.textContent = it.label; b.appendChild(sp);
    if (it.sc){ const sc = document.createElement("span"); sc.className = "sc"; sc.textContent = it.sc; b.appendChild(sc); }
    b.addEventListener("click", () => { closePop(); if (it.pick) it.pick(); });
    node.appendChild(b);
  });
  plateEl.appendChild(node);
  const wRem = node.offsetWidth / cell;
  const leftRem = opts.alignRight
    ? ((ar.right - pr.left)/cell - wRem)
    : ((ar.left - pr.left)/cell);
  node.style.left = Math.max(0.5, leftRem) + "rem";
  node.style.top = ((ar.bottom - pr.top)/cell + 0.3) + "rem";
  node.style.minWidth = (ar.width/cell) + "rem";
  anchor.setAttribute("aria-expanded", "true");
  popNode = node; popAnchor = anchor;
}
document.addEventListener("pointerdown", (e) => {
  if (popNode && !popNode.contains(e.target) && e.target !== popAnchor) closePop();
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && popNode) closePop(); });

/* preset dropdown -------------------------------------------------------- */
const PRESETS = ["INIT", "SLOW GLASS", "TIDE LINE", "GLASS CUT", "HARMONIC VEIL", "IRON DUST"];
const ddPreset = $("#dd-preset");
ddPreset.addEventListener("click", () => {
  openPop(ddPreset, PRESETS.map((p, i) => ({
    label: String(i).padStart(3, "0") + "  " + p,
    checked: i === 4,
    pick(){ $("#dd-preset-v").textContent = String(i).padStart(3, "0") + " " + p; }
  })), { header:"Preset bank A", role:"listbox" });
});

/* type dropdown ---------------------------------------------------------- */
const ddType = $("#dd-type");
ddType.addEventListener("click", () => {
  openPop(ddType, TYPES.map((t) => ({
    label: t, checked: S.type === t,
    pick(){ S.type = t; $("#dd-type-v").textContent = t; analyse(); drawGraph(); }
  })), { role:"listbox" });
});

/* menu ------------------------------------------------------------------- */
const btnMenu = $("#btn-menu");
btnMenu.addEventListener("click", () => {
  openPop(btnMenu, [
    { label:"Init preset", sc:"Ctrl+I" },
    { label:"Copy A to B", sc:"Ctrl+Shift+C" },
    "-",
    { label:"Specimen index", sc:"A", checked:S.anatomy, pick(){ setAnatomy(true); } },
    { label:"Paper day", sc:"T", checked:S.surface === "day",
      pick(){ setSurface(S.surface === "day" ? "night" : "day"); } },
    { label:"Restore defaults", sc:"dbl-click" },
    "-",
    { label:"About F-30", sc:"v1.0" }
  ], { role:"menu", alignRight:true, header:"APC Filter F-30" });
});
/* numberfield ------------------------------------------------------------ */
let bpm = 120;
function setBpm(v){
  bpm = clamp(Math.round(v), 40, 240);
  S.bpm = bpm;
  $("#nf-bpm-v").textContent = String(bpm);
}
const nf = $("#nf-bpm");
nf.addEventListener("wheel", (e) => { e.preventDefault(); setBpm(bpm + (e.deltaY < 0 ? 1 : -1)); }, { passive:false });
nf.addEventListener("keydown", (e) => {
  if (e.key === "ArrowUp" || e.key === "ArrowRight"){ e.preventDefault(); setBpm(bpm + 1); }
  if (e.key === "ArrowDown" || e.key === "ArrowLeft"){ e.preventDefault(); setBpm(bpm - 1); }
});
(() => {
  let drag = null;
  nf.addEventListener("pointerdown", (e) => {
    try { nf.setPointerCapture(e.pointerId); } catch (err) {}
    drag = { y:e.clientY, v:bpm };
    nf.focus({ preventScroll:true });
    e.preventDefault();
  });
  nf.addEventListener("pointermove", (e) => {
    if (!drag) return;
    setBpm(drag.v + Math.round((drag.y - e.clientY)/(cell*0.8)));
  });
  nf.addEventListener("pointerup", () => { drag = null; });
})();

/* textfield -------------------------------------------------------------- */
const tf = $("#tf-name");
tf.addEventListener("input", () => { tf.value = tf.value.toUpperCase().replace(/[^A-Z0-9 ]/g, ""); });
tf.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === "Escape") tf.blur(); });
tf.addEventListener("change", () => {
  if (!tf.value.trim()) tf.value = "UNTITLED";
  S.patterns[S.pattern] = tf.value.trim();
  renderPatterns();
});

/* list ------------------------------------------------------------------- */
function renderPatterns(){
  const box = $("#list-patterns");
  box.innerHTML = "";
  S.patterns.forEach((p, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("role", "option");
    b.setAttribute("aria-selected", String(i === S.pattern));
    const ix = document.createElement("span"); ix.className = "ix";
    ix.textContent = String(i+1).padStart(2, "0");
    const nm = document.createElement("span"); nm.textContent = p;
    b.appendChild(ix); b.appendChild(nm);
    b.addEventListener("click", () => {
      S.pattern = i; $("#tf-name").value = p; renderPatterns();
    });
    box.appendChild(b);
  });
  const pc = $("#pat-count");
  if (pc) pc.textContent = String(S.patterns.length).padStart(2, "0");
}

/* transport -------------------------------------------------------------- */
function paintTransport(){
  $("#btn-run").setAttribute("aria-pressed", String(S.playing));
  $("#btn-stop").setAttribute("aria-pressed", String(!S.playing));
  $("#btn-loop").setAttribute("aria-pressed", String(S.loop));
}
$("#btn-run").addEventListener("click", () => { S.playing = true; paintTransport(); });
$("#btn-stop").addEventListener("click", () => { S.playing = false; paintTransport(); });
$("#btn-loop").addEventListener("click", () => { S.loop = !S.loop; paintTransport(); });
$("#btn-save").addEventListener("click", () => {
  const name = ($("#tf-name").value || "UNTITLED").trim();
  if (!S.patterns.includes(name)) S.patterns.push(name);
  S.pattern = S.patterns.indexOf(name);
  renderPatterns();
});

/* xy pad + graph pointer ------------------------------------------------- */
const xyWell = xyCv.parentElement;
let xyDrag = false;
function xyAt(e, push){
  const r = xyWell.getBoundingClientRect();
  S.xy.x = clamp((e.clientX - r.left)/Math.max(1,r.width), 0, 1);
  S.xy.y = clamp((e.clientY - r.top)/Math.max(1,r.height), 0, 1);
  if (push && xyTrail.length < 6) xyTrail.push({ x:S.xy.x, y:S.xy.y });
  applyXY(true);
}
xyWell.addEventListener("pointerdown", (e) => {
  try { xyWell.setPointerCapture(e.pointerId); } catch (err) {} xyDrag = true; xyAt(e, false); e.preventDefault();
});
xyWell.addEventListener("pointermove", (e) => { if (xyDrag) xyAt(e, true); });
xyWell.addEventListener("pointerup", () => { xyDrag = false; });
xyWell.addEventListener("pointercancel", () => { xyDrag = false; });

const graphWell = graphCv.parentElement;
let nodeDrag = false;
function graphAt(e){
  const r = graphCv.getBoundingClientRect();
  S.cursor = e.clientX - r.left;
  if (nodeDrag){
    const t = clamp((S.cursor - G.x0)/G.w, 0, 1);
    S.xy.x = t;
    const ty = clamp((e.clientY - r.top - G.y0)/G.h, 0, 1);
    S.xy.y = clamp(ty, 0.02, 0.98);
    applyXY(true);
  }
  drawGraph();
}
graphWell.addEventListener("pointerdown", (e) => {
  try { graphWell.setPointerCapture(e.pointerId); } catch (err) {} nodeDrag = true; graphAt(e); e.preventDefault();
});
graphWell.addEventListener("pointermove", graphAt);
graphWell.addEventListener("pointerup", () => { nodeDrag = false; });
graphWell.addEventListener("pointerleave", () => { S.cursor = null; drawGraph(); });

/* step faders: drag anywhere on the lane to set the values */
const seqWell = seqCv.parentElement;
let seqDrag = false;
function seqAt(e){
  const r = seqCv.getBoundingClientRect();
  const n = 16, gap = Math.max(2, cell*0.26);
  const colW = (r.width - gap*(n-1))/n;
  const laneH = r.height - cell*1.1;
  const i = clamp(Math.floor((e.clientX - r.left)/(colW+gap)), 0, n-1);
  const top = laneH - cell*0.35;
  const y = clamp(e.clientY - r.top, 0, top);
  S.seq.value[i] = clamp(1 - y/top, 0.02, 1);
  drawSeq();
}
seqWell.addEventListener("pointerdown", (e) => {
  try { seqWell.setPointerCapture(e.pointerId); } catch (err) {} seqDrag = true; seqAt(e); e.preventDefault();
});
seqWell.addEventListener("pointermove", (e) => { if (seqDrag) seqAt(e); });
seqWell.addEventListener("pointerup", () => { seqDrag = false; });
seqWell.addEventListener("pointercancel", () => { seqDrag = false; });
/* ==========================================================================
   11  SPECIMEN INDEX (anatomy)
   ======================================================================= */
const LIST = ["knob","slider","selector","toggle","button","buttons","segmented","checkbox",
  "radio","dropdown","menu","tabs","textfield","numberfield","label","readout","panel",
  "divider","led","progress","list","logo","graph","envelope","spectrum","waveform",
  "scope","meter","stepseq","xypad"];
const NAMES = {
  knob:"Knob", slider:"Slider", selector:"Selector", toggle:"Toggle", button:"Button",
  buttons:"Buttons", segmented:"Segmented", checkbox:"Checkbox", radio:"Radio",
  dropdown:"Dropdown", menu:"Menu", tabs:"Tabs", textfield:"Textfield",
  numberfield:"Number field", label:"Label", readout:"Readout", panel:"Panel",
  divider:"Divider", led:"LED", progress:"Progress", list:"List", logo:"Logo",
  graph:"Graph", envelope:"Envelope", spectrum:"Spectrum", waveform:"Waveform",
  scope:"Scope", meter:"Meter", stepseq:"Step sequencer", xypad:"XY pad"
};
const tagsEl = $("#tags");

function buildTags(){
  tagsEl.innerHTML = "";
  if (!S.anatomy) return;
  const pr = plateEl.getBoundingClientRect();
  const seen = {};
  $$("[data-el]", plateEl).forEach((node) => {
    const i = LIST.indexOf(node.dataset.el);
    if (i < 0 || seen[node.dataset.el]) return;   /* one tag per type, hover shows the rest */
    const r = node.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    seen[node.dataset.el] = true;
    const t = document.createElement("span");
    t.className = "tag";
    t.textContent = String(i+1).padStart(2, "0");
    const above = (r.top - pr.top) > cell*0.85 && (r.left - pr.left) > cell*0.55;
    t.style.left = (((r.left - pr.left)/cell) - (above ? 0.45 : -0.08)) + "rem";
    t.style.top  = (((r.top - pr.top)/cell) - (above ? 0.62 : -0.06)) + "rem";
    tagsEl.appendChild(t);
  });
}
function highlight(type, on){
  $$(".hl").forEach((n) => n.remove());
  if (!on) return;
  const pr = plateEl.getBoundingClientRect();
  $$("[data-el=\"" + type + "\"]", plateEl).forEach((node) => {
    const r = node.getBoundingClientRect();
    const d = document.createElement("div");
    d.className = "hl";
    d.style.left = ((r.left - pr.left)/cell) + "rem";
    d.style.top = ((r.top - pr.top)/cell) + "rem";
    d.style.width = (r.width/cell) + "rem";
    d.style.height = (r.height/cell) + "rem";
    plateEl.appendChild(d);
  });
}
function buildSheet(){
  const grid = $("#sheet-grid");
  grid.innerHTML = "";
  LIST.forEach((type, i) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "it";
    b.setAttribute("aria-pressed", "false");
    const n = document.createElement("span"); n.className = "n";
    n.textContent = String(i+1).padStart(2, "0");
    const nm = document.createElement("span"); nm.className = "nm";
    nm.textContent = NAMES[type] || type;
    b.appendChild(n); b.appendChild(nm);
    b.addEventListener("mouseenter", () => highlight(type, true));
    b.addEventListener("focus", () => highlight(type, true));
    b.addEventListener("mouseleave", () => highlight(type, false));
    b.addEventListener("blur", () => highlight(type, false));
    b.addEventListener("click", () => {
      const on = b.getAttribute("aria-pressed") !== "true";
      $$(".it", grid).forEach((x) => x.setAttribute("aria-pressed", "false"));
      b.setAttribute("aria-pressed", String(on));
      highlight(type, on);
    });
    grid.appendChild(b);
  });
}
function coverage(){
  const present = new Set($$("[data-el]", plateEl).map((n) => n.dataset.el));
  const missing = LIST.filter((t) => !present.has(t));
  return { count: present.size, missing };
}
function setAnatomy(on){
  S.anatomy = !!on;
  rootEl.dataset.anatomy = S.anatomy ? "on" : "off";
  rootEl.dataset.sheet = S.anatomy ? "on" : "off";
  $("#btn-help").setAttribute("aria-pressed", String(S.anatomy));
  try { localStorage.setItem("apc-f30-anatomy", S.anatomy ? "1" : "0"); } catch (err) {}
  if (S.anatomy) buildSheet();
  requestAnimationFrame(() => {
    readTheme();
    drawAll();
    if (S.anatomy) buildTags();
  });
}

/* ==========================================================================
   12  SURFACE
   ======================================================================= */
function setSurface(v){
  S.surface = v;
  rootEl.dataset.surface = v;
  try { localStorage.setItem("apc-f30-surface", v); } catch (err) {}
  $$("#seg-surface button").forEach((b) => {
    b.setAttribute("aria-pressed", String(b.dataset.surfaceSet === v));
  });
  requestAnimationFrame(() => {
    readTheme();
    drawAll();
    if (S.anatomy) buildTags();
  });
}
$("#btn-help").addEventListener("click", () => setAnatomy(!S.anatomy));

document.addEventListener("keydown", (e) => {
  const tag = (e.target.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea") return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === "t" || e.key === "T") setSurface(S.surface === "day" ? "night" : "day");
  if (e.key === "a" || e.key === "A") setAnatomy(!S.anatomy);
  if (e.key === " " && tag !== "button"){
    e.preventDefault();
    S.playing = !S.playing;
    paintTransport();
  }
});
/* ==========================================================================
   13  LOOP
   ======================================================================= */
const ledGate = $("#led-gate"), ledSignal = $("#led-signal"), ledClip = $("#led-clip");
let clipUntil = 0;

function ballistics(cur, target, dt){
  const coeff = target > cur ? 0.55 : 0.055;
  return cur + (target - cur) * Math.min(1, coeff * (dt/16.7));
}
function updateMeter(dt){
  const base = S.playing ? (-20 + S.gain*0.45 - (S.reso-2.4)*0.9) : -74;
  const tl = base + Math.sin(S.t*0.0017)*2.4 + Math.sin(S.t*0.0051)*1.7;
  const tr = base + Math.sin(S.t*0.0019+1.3)*2.6 + Math.sin(S.t*0.0047+0.4)*1.6;
  const L = S.level;
  L.l = ballistics(L.l, clamp(tl,-72,3), dt);
  L.r = ballistics(L.r, clamp(tr,-72,3), dt);
  L.pl = L.l > L.pl ? L.l : Math.max(L.l, L.pl - dt*0.012);
  L.pr = L.r > L.pr ? L.r : Math.max(L.r, L.pr - dt*0.012);
  if (L.pl > -0.4 || L.pr > -0.4) clipUntil = performance.now() + 900;
}

let last = performance.now();
function frame(ts){
  const dt = Math.min(80, ts - last);
  last = ts;
  if (!S.hold) S.t += dt;

  if (S.playing){
    const stepDur = 60000 / S.bpm / 4;
    S.stepPhase += dt / stepDur;
    while (S.stepPhase >= 1){
      S.stepPhase -= 1;
      S.step = (S.step + 1) % 16;
      if (S.step === 0) S.bar = (S.bar % 4) + 1;
      ledGate.dataset.on = S.seq.value[S.step] > 0.5 ? "1" : "0";
    }
  } else {
    ledGate.dataset.on = "0";
  }

  updateMeter(dt);
  ledSignal.dataset.on = (S.playing && !S.hold) ? "1" : "0";
  ledClip.dataset.on = performance.now() < clipUntil ? "1" : "0";

  drawSpectrum();
  drawWave();
  drawScope();
  drawMeter();
  drawSeq();

  S.analysis = (S.analysis + dt/120) % 100;
  $("#pr-ana .fill").style.width = S.analysis.toFixed(1) + "%";
  $("#pr-ana-v").textContent = Math.round(S.analysis) + "%";
  $("#pr-pos .fill").style.width = (((S.step + S.stepPhase)/16)*100).toFixed(1) + "%";
  $("#pr-pos-v").textContent = S.bar + "." + (1 + (S.step % 4));

  if ((tick++ & 7) === 0){
    const outEl = $("#ro-out");
    if (outEl) outEl.textContent = fmtDb(Math.max(S.level.l, S.level.r), 1);
  }

  requestAnimationFrame(frame);
}
let tick = 0;

/* ==========================================================================
   14  INIT
   ======================================================================= */
function drawAll(){
  analyse();
  drawGraph();
  drawSpectrum();
  drawWave();
  drawScope();
  drawMeter();
  drawEnv();
  drawSeq();
  drawXY();
}

readTheme();
K.cutoff.setValue(1200, true);
K.reso.setValue(2.4, true);
K.drive.setValue(3, true);
SL.gain.setValue(0, true);
SL.a.setValue(12, true);
SL.d.setValue(240, true);
SL.s.setValue(55, true);
SL.r.setValue(480, true);
drawParams();
renderPatterns();
paintTransport();
drawAll();

try {
  const sv = localStorage.getItem("apc-f30-surface");
  if (sv === "day") setSurface("day");
  if (localStorage.getItem("apc-f30-anatomy") === "1") setAnatomy(true);
} catch (err) {}

/* ?surface=day | ?anatomy=1 for sharing a state without localStorage */
try {
  const qs = new URLSearchParams(location.search);
  if (qs.get("surface") === "day") setSurface("day");
  if (qs.get("surface") === "night") setSurface("night");
  if (qs.get("anatomy") === "1") setAnatomy(true);
} catch (err) {}

const cov = coverage();
$("#ro-el").textContent = cov.count + "/30";
$("#sheet-check").textContent = cov.count + " / 30";
$("#sheet").setAttribute("data-missing", cov.missing.join(",") || "none");

if (window.ResizeObserver){
  let raf = 0;
  new ResizeObserver(() => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      readTheme();
      drawAll();
      if (S.anatomy) buildTags();
    });
  }).observe(plateEl);
}
requestAnimationFrame(frame);
})();

/* ---- hub / KIT page handshake ------------------------------------------------
   The KIT page asks the stage for data-ref-ready and reads window.__APC_REF__.
   This plate has no overlays (no settings / presets / license / update sheets),
   so it also answers data-ref-overlays="0" and the page hides that strip. */
document.documentElement.setAttribute("data-ref-ready", "1");
if (!getComputedStyle(document.documentElement).getPropertyValue("--cols").trim()) {
  document.documentElement.style.setProperty("--cols", "120");
  document.documentElement.style.setProperty("--rows", "70");
}
document.documentElement.setAttribute("data-ref-mounted", String(document.querySelectorAll("[data-el]").length));
document.documentElement.setAttribute("data-ref-overlays", "0");
window.__APC_REF__ = window.__APC_REF__ || {};
window.__APC_REF__.ready = true;
window.__APC_REF__.mounted = document.querySelectorAll("[data-el]").length;
window.__APC_REF__.errors = window.__APC_REF__.errors || [];
