/* =============================================================================
   apc-widgets.js - APC UI kit widgets: the complete set of NON-visualisation plugin UI elements.
   Classic script (ES5, no modules, no network). Extends window.APC. Contract: CONTRACT.md.
   Load after apc-kit.js, apc-bridge.js and apc-controls.js (param-bound widgets and the
   numberfield reuse APC.controls.Model: the SAME parsing/formatting as the knob's value entry).
   CSS: apc-widgets.css (token-only, :where() low specificity, rem sizes) after apc-components.css.
   The re-skinned knob / slider / selector / toggle live in apc-controls.js (styled in
   apc-components.css); they are listed at the end of this header for completeness.

   COMMON TO EVERY WIDGET
     Mount      <div data-apc="NAME" data-...></div>   then APC.mount(root). Each init returns {dispose()}.
     Options    data-label      visible caption (also the accessible name where there is no other)
                data-aria-label accessible name when there is no visible label
                data-title      tooltip (title attribute)
                data-size       sm | md | lg | <css length> | <number = rem>  (sets --w-h, the control height)
                data-disabled   "true" (or empty) = disabled; handle.setDisabled(bool) at runtime
                data-param      parameter id (only on parameter-bound widgets, see each element)
     Host       gets class "apc-w apc-w--NAME", a unique id (kept if you gave one), aria-disabled/data-disabled,
                is-error + aria-invalid + data-error="<msg>" when in an error state (e.g. unknown parameter).
     Events     DOM  CustomEvent "apc:change" on the host (bubbles) detail {id, kind, param?, value, ...}
                Bus  APC.emit("widget:change", sameDetail)
     Handle     el.__apcW  ==  APC.widgets.get(el): {el, kind, id, setDisabled(b), isDisabled(), dispose(), ...per element}
     Parameters The widget reads the ParamDescriptor with apc.params.get, writes with apc.param.begin/set/end
                (one complete host gesture per discrete change), follows `param`/`preset` bridge events and
                `params:changed`, and pushes "undo:push" like the knob. Bridge failures are shown through
                APC.toast.error (never silent). A parameter that cannot be read puts the widget into the error
                state (aria-invalid, is-error) and disables it. Choice parameters expose descriptor.choices
                (labels cross the bridge as labels); two-state/boolean parameters work as checked = value > min.
     Many instances coexist: no global state except the shared bridge subscription; APC.widgets.stats()
     returns {listeners, timers, binds, popups, widgets} (all return to their previous value after dispose()).
     Popups (dropdown, menu) are fixed layers on <body>, sized in rem, positioned/flipped/clamped inside
     the .apc-plate (or the viewport), they scroll when taller than the free space and close on outside click.
     prefers-reduced-motion: no widget animates (the indeterminate progress bar becomes a static segment).
     Focus ring: outline var(--apc-focus). All colour/shape/type from tokens; see .agents/guides/ui-kit-widgets.md.

   ---------------------------------------------------------------------------------------------
   button      <div data-apc="button" data-label="Reset" data-variant="action"></div>
               <button data-apc="button" ...> is also accepted (the element itself becomes the control)
     options   data-variant  action (momentary, default) | latch (toggle, aria-pressed) | primary (action, emphasised)
               data-label / content text; data-icon="▶" (glyph) or a child with data-slot="icon" (e.g. inline <svg>)
               data-led="true|ok|warn|error"  LED slot (on while latched / held; the tone colours it)
               data-pressed="true"  initial latch state;  data-action="name"  action name in events
               data-param  optional: action = momentary (press writes the max/on value, release the min/off value,
                           one host gesture); latch = toggles min/max (pressed = value > min)
     events    action: DOM "apc:click" {id,pressed}, bus APC.emit("button",{id,variant,action,param?,pressed})
               latch:  "apc:change" {pressed,value} + the same bus event
     keys      Enter / Space activate (native button); with data-param Enter/Space press on keydown, release on keyup
     aria      <button>; latch: aria-pressed; icon-only: aria-label (data-aria-label / data-title)
     handle    getPressed(), setPressed(b), setLabel(t), setLed(state), click(), focus()

   buttons / segmented   one choice of N shown as a button row/column
               <div data-apc="buttons" data-label="WAVE" data-param="osc_wave"></div>
               <div data-apc="segmented" data-items='["A","B","C"]' data-value="B" data-orient="vertical"></div>
               <div data-apc="buttons"><option value="a">A</option><option value="b" disabled>B</option></div>
     options   data-param (choice parameter; or a stepped numeric parameter / data-items with numeric values),
               data-items JSON [ "A", {"value":"b","label":"B","disabled":true,"icon":"●","title":".."} ] or "A|B|C",
               child <option value= disabled selected>, data-value (initial), data-orient horizontal|vertical, data-label
     events    "apc:change" {index,value,label}
     keys      roving tabindex; Arrow keys (all four) move AND select (wrap), Home/End, Space/Enter select the focused one
     aria      role=radiogroup (aria-labelledby the label, aria-orientation) > role=radio items (aria-checked, aria-disabled)
     handle    getValue(), getIndex(), getLabel(), setIndex(i), setItems(list) (static only), focus()

   checkbox    <div data-apc="checkbox" data-label="Bypass" data-param="bypass"></div>
     options   data-param (boolean / two-state), data-checked, data-indeterminate (shows "mixed" until the first toggle), data-label
     events    "apc:change" {checked,value};  keys Space toggles (click anywhere on box or label);
     aria      role=checkbox, aria-checked true|false|mixed, aria-labelledby;  handle isChecked(), setChecked(b), focus()

   radio       <div data-apc="radio" data-label="Mode" data-param="mode"></div>   (same options/events/keys/aria as buttons)
     options   rendered as indicator + label rows; stacked (vertical) by default, data-orient="horizontal" puts them in a row

   dropdown    closed field + popup listbox
               <div data-apc="dropdown" data-label="WAVE" data-param="osc_wave" data-searchable="true"></div>
               <div data-apc="dropdown" data-placeholder="Pick one"><option>One</option><option>Two</option></div>
     options   as buttons (data-param | data-items | <option>), data-placeholder (shown when nothing is selected),
               data-searchable="true" (filter field in the popup)
     events    "apc:change" {index,value,label}
     keys      closed: ArrowDown/ArrowUp/Enter/Space/Alt+Down open; Home/End open at first/last; typing opens + jumps (type-ahead).
               open: ArrowUp/Down move, PageUp/Down ±5, Home/End, Enter (and Space unless searchable) choose, Esc close (focus back),
               Tab closes without choosing, typing = type-ahead (or filter when searchable). Mouse: click toggles, hover highlights.
     aria      field role=combobox aria-haspopup=listbox aria-expanded aria-controls aria-activedescendant; popup role=listbox > role=option
     handle    getValue(), getIndex(), getLabel(), setIndex(i), open(), close(), isOpen(), setItems(list), focus()

   menu        popup / anchor menu, one submenu level
               <div data-apc="menu" data-label="File" data-items='[{"id":"new","label":"New","shortcut":"Ctrl+N"},"-",
                    {"id":"snap","label":"Snap","checked":true},{"id":"x","label":"Export","items":[{"id":"wav","label":"WAV"}]}]'></div>
               children form: <div data-id="new" data-shortcut="Ctrl+N">New</div> <hr> <div data-id="more" data-label="More"><div data-id="a">A</div></div>
     item keys id, label, shortcut (hint text), checked (true/false = checkable, toggles on use), disabled, title, items[] (submenu),
               "-" or {separator:true}
     options   data-label (caption of the trigger button), data-trigger="none" (no button), data-context="true|parent|<selector>"
               (open at the pointer on contextmenu / ContextMenu key / Shift+F10 of that area), data-onselect="globalFunctionName"
     events    APC.emit("menu", {id: <host id>, item: {id,label,checked,shortcut}}), DOM "apc:select" {id,item}, handle.onselect(item)
               (assign a function), data-onselect global function. Programmatic: APC.widgets.openMenu(items,{x,y|anchor,onselect,id}).
     keys      trigger: Enter/Space/click open, ArrowDown/ArrowUp open at first/last. Menu: ArrowUp/Down (wrap), Home/End, Right opens a
               submenu, Left/Esc closes it (Esc on the root closes and refocuses the trigger), Enter/Space use, Tab closes, typing = type-ahead
     aria      trigger aria-haspopup=menu aria-expanded; popup role=menu > menuitem | menuitemcheckbox (aria-checked) | separator;
               submenu rows aria-haspopup=menu aria-expanded; aria-disabled on disabled rows
     handle    open({x,y,focus}), openAt(x,y), close(), isOpen(), setItems(list), getItems(), onselect

   tabs        <div data-apc="tabs" data-orient="horizontal"><section data-tab="OSC">..</section><section data-tab="FX" data-disabled>..</section></div>
     options   children with data-tab="Title" become panels (data-selected / data-value = index | title | panel id picks the start tab),
               data-orient horizontal|vertical, data-label (name of the tablist)
     events    "apc:change" {index,value,panel};  keys roving tabindex; Left/Right (horizontal) or Up/Down (vertical) move+activate (wrap,
               skip disabled), Home/End;  aria role=tablist(aria-orientation) > role=tab (aria-selected, aria-controls) + role=tabpanel (aria-labelledby, hidden)
     handle    select(i), getIndex(), getValue(), setTabDisabled(i,b), focus()

   textfield   single-line text, e.g. a preset name
               <div data-apc="textfield" data-label="NAME" data-placeholder="Untitled" data-maxlength="40" data-required="true"
                    data-pattern="[\w \-]+" data-pattern-message="Letters, digits, space, dash" data-help="Shown under the field"></div>
     options   data-value, data-type text|search|password|email|url, data-placeholder, data-maxlength, data-minlength, data-required,
               data-pattern (full-match regex), data-pattern-message, data-required-message, data-help, data-error (start in the error state)
     events    "apc:input" {value} while typing; "apc:change" {value} on commit (Enter or blur, only when valid); "apc:submit" {value} on Enter
     keys      Enter commits (invalid: stays focused with the message), Esc restores the last committed value
     aria      native <input> + <label for>; aria-invalid, aria-required, aria-describedby -> message (role=alert when in error)
     handle    getValue(), setValue(v), setError(msg|null), validate(), validator = function(value) -> "message" | null, focus()

   numberfield typed numeric with units and step buttons (parsing/format shared with the knob's value entry)
               <div data-apc="numberfield" data-label="CUTOFF" data-param="cutoff_hz"></div>
               <div data-apc="numberfield" data-min="20" data-max="20000" data-step="1" data-unit="Hz" data-value="440"></div>
     options   data-param, or static data-min/data-max/data-step/data-unit/data-value/data-default/data-digits, data-steppers="false"
     units     Hz kHz dB % ms s, "1.2k", decimal comma; out of range -> clamped + hint "Clamped to ..."; invalid -> error state + reason
     events    "apc:change" {value,text};  keys Enter commit, Esc revert, ArrowUp/Down step (Shift fine), PageUp/Down coarse, wheel while focused;
               step buttons: click, hold to repeat (one host gesture for the hold)
     aria      <input role=spinbutton aria-valuemin/max/now/text>, buttons "Decrease"/"Increase" (tabindex -1: the keys cover the keyboard)
     handle    getValue(), setValue(v), getText(), focus()

   label       static text   <span data-apc="label" data-role="title|label|caption|value" data-text="CUTOFF" data-for="#myctl"></span>
     options   data-role (title = heading role, data-level), data-text (else the element's own text), data-for (selector or id of the
               widget this text names: sets its aria-labelledby);  handle setText(t), getText()

   readout     live read-only value   <div data-apc="readout" data-param="cutoff_hz" data-label="CUTOFF"></div>
               <div data-apc="readout" data-meter="out.peak" data-unit="dB" data-digits="1"></div>
     options   data-param (formatted like the knob readout) | data-meter (bridge `meter` event id, number) | handle.setValue(number|text),
               data-unit, data-digits, data-label, data-layout stack|inline, data-align start|center|end, data-size
     aria      <output aria-live="off"> named by the label (no announcements while values stream); handle setValue(v), getText()

   panel       titled frame   <div data-apc="panel" data-title="FILTER" data-collapsible="true" data-collapsed="false">...children...</div>
     options   data-title (or data-label), data-collapsible, data-collapsed
     events    "apc:toggle" {collapsed}, "apc:change" {collapsed};  keys the header is a native button (Enter/Space)
     aria      role=group aria-labelledby title; toggle aria-expanded aria-controls;  handle isCollapsed(), setCollapsed(b), toggle(), body

   divider     <div data-apc="divider" data-orient="horizontal|vertical" data-label="OUTPUT"></div>  (role=separator, aria-orientation)

   led         <span data-apc="led" data-label="CLIP" data-state="error"></span>   <span data-apc="led" data-param="bypass" data-label="ACTIVE"></span>
     options   data-state on|off|ok|warn|error, data-on, data-param (on = value > min), data-states="off,ok,warn,error" maps a choice
               parameter's index to a state, data-label;  aria role=img aria-label "label: state";  handle setState(s), getState(), setOn(b)

   progress    <div data-apc="progress" data-label="LOAD" data-value="0.4" data-show-value="true"></div>  / data-indeterminate="true"
     options   data-value, data-min, data-max (default 0..1), data-indeterminate, data-show-value, data-state ok|warn|error,
               data-orient horizontal|vertical, data-param | data-meter (live);  aria role=progressbar aria-valuenow/min/max/valuetext
               (no valuenow while indeterminate);  handle setValue(v), getValue(), setIndeterminate(b), setState(s)

   list        listbox   <div data-apc="list" data-multiple="true" data-rows="6" data-label="LAYERS" data-items='["A","B"]'></div>
     options   data-items | <option> children | data-param (single-select, choice parameter), data-multiple, data-value (initial: JSON array
               or comma list when multiple), data-rows (visible rows, then scrolls), data-label
     events    "apc:change" {value, indices} (value is an array when multiple), "apc:activate" {index} on Enter / double-click
     keys      one tab stop (aria-activedescendant); Up/Down, Home/End, PageUp/Down, typing = type-ahead. Single: selection follows
               focus. Multiple: Space (or a plain click) toggles, Shift+Arrow / Shift+click extends a range, Ctrl/Cmd+A selects all
     aria      role=listbox (aria-multiselectable) > role=option aria-selected;  handle getValue(), getIndices(), setValue(v), setItems(list), focus()

   logo        wordmark / lockup slot   <div data-apc="logo" data-text="ACME" data-sub="AUDIO" data-link="company"></div>
               <div data-apc="logo" data-src="logo.svg" data-alt="Acme"></div>   <div data-apc="logo"><svg>..</svg></div>
     options   data-text, data-sub (small second line), data-src (image URL/data URI, no network is ever fetched by the kit),
               child <svg>/<img> kept, data-alt, data-url (literal) or data-link="company|product|docs|support" (resolved from apc.info links).
               A button is rendered ONLY when a URL is configured; a click calls APC.bridge.call("apc.openUrl",{url}) (native allow-lists it).
     aria      image/svg marks get role=img + aria-label (the alt);  link button aria-label "Open <alt> website"

   tooltip / toast / dialogs: unchanged components (apc-help.js, apc-kit.js, apc-settings.js ...), styled flat in apc-components.css.

   RE-SKINNED in apc-controls.js (behaviour unchanged, all existing options kept; see the guide): knob, slider, selector, toggle
     common new options: data-size (sm|md|lg|<length>|<number=rem>: knob diameter / slider length), data-disabled,
       data-readout above|below|none (also data-readout="false"), data-unit inline|separate|none, data-ticks="5|steps",
       data-bipolar (arc from the centre), data-orient (alias of data-orientation) for the slider,
       selector: visible prev/next buttons (data-steppers="false" hides them), toggle: data-variant="button" for the boxed look.
   ============================================================================= */
(function () {
  "use strict";
  var APC = (window.APC = window.APC || {});
  if (APC.__widgets) return;
  if (!APC.register || !APC.dom) {
    if (window.console) console.error("apc-widgets.js: load apc-kit.js first");
    return;
  }
  APC.__widgets = true;
  var h = APC.dom.el;
  var SVGNS = "http://www.w3.org/2000/svg";

  /* ---- small utilities ------------------------------------------------------------------ */
  var seq = 0;
  var live = { listeners: 0, timers: 0, binds: 0, popups: 0, widgets: 0 };     /* leak counters (tests: APC.widgets.stats()) */
  function uid(p) { seq++; return "apcw-" + (p || "x") + "-" + seq; }
  function bool(v, d) {
    if (v === undefined || v === null) return d;
    v = String(v).toLowerCase();
    if (v === "" || v === "true" || v === "1" || v === "yes" || v === "on") return true;
    if (v === "false" || v === "0" || v === "no" || v === "off") return false;
    return d;
  }
  function numOr(v, d) { var n = parseFloat(v); return isFinite(n) ? n : d; }
  function jsonOr(v, d) { if (v === undefined || v === null || v === "") return d; try { return JSON.parse(v); } catch (e) { return d; } }
  function clamp(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }
  function cls(el, name, on) { if (on) el.classList.add(name); else el.classList.remove(name); }
  function textOf(el) { return (el.textContent || "").replace(/\s+/g, " ").trim(); }
  function ownText(el) {
    var s = "", c = el.firstChild;
    while (c) { if (c.nodeType === 3) s += c.nodeValue; c = c.nextSibling; }
    return s.replace(/\s+/g, " ").trim();
  }
  function svgEl(tag, attrs) {
    var n = document.createElementNS(SVGNS, tag), k;
    for (k in (attrs || {})) n.setAttribute(k, attrs[k]);
    return n;
  }
  function report(msg, detail, source) {
    APC.emit("error", { message: msg, detail: detail ? String(detail) : "", source: source || "apc-widgets" });
  }
  function fire(el, type, detail) {
    var ev;
    try { ev = new CustomEvent(type, { bubbles: true, detail: detail }); }
    catch (e) { ev = document.createEvent("CustomEvent"); ev.initCustomEvent(type, true, false, detail); }
    el.dispatchEvent(ev);
  }
  function dir(o) { return /^v/i.test(String(o.orient || o.orientation || "")) ? "vertical" : "horizontal"; }

  /* bridge call - never fails silently (stone rule 1). Reuses apc-controls' helper when present. */
  function call(name, args) {
    var C = APC.controls, p;
    if (C && C.call) return C.call(name, args);
    try {
      if (!APC.bridge || !APC.bridge.call) throw new Error("bridge unavailable");
      p = APC.bridge.call(name, args || {});
    } catch (e) { p = Promise.reject(e); }
    return Promise.resolve(p).then(function (r) {
      if (r && r.error) {
        if (r.error === "gated") APC.emit("license:gated", { fn: name, result: r });
        else report("Could not complete " + name + ": " + (r.message || r.error), r.error, name);
      }
      return r;
    }, function (e) { report("Could not complete " + name + ": " + ((e && e.message) || e), e, name); return undefined; });
  }

  /* ---- widget base: listener/timer bookkeeping, disabled state, change events ------------- */
  function base(el, kind, o) {
    var w = { el: el, kind: kind, o: o, disposed: false, disabled: bool(o.disabled, false), offs: [], timers: [], extra: [] };
    if (!el.id) el.id = uid(kind);
    w.id = el.id;
    el.classList.add("apc-w", "apc-w--" + kind);
    var sz = o.size;
    if (sz) {                                                  /* data-size: sm | md | lg | <length> | <number = rem> */
      if (sz === "sm") el.style.setProperty("--w-h", "1.25rem");
      else if (sz === "lg") el.style.setProperty("--w-h", "2rem");
      else if (sz !== "md") el.style.setProperty("--w-h", /^[\d.]+$/.test(sz) ? sz + "rem" : sz);
      el.setAttribute("data-size", sz);
    }
    w.on = function (node, type, fn, opt) {
      node.addEventListener(type, fn, opt || false); live.listeners++;
      w.offs.push(function () { node.removeEventListener(type, fn, opt || false); live.listeners--; });
    };
    w.later = function (fn, ms) {
      var t = setTimeout(function () {
        var i = w.timers.indexOf(t); if (i > -1) { w.timers.splice(i, 1); live.timers--; }
        if (!w.disposed) fn();
      }, ms);
      w.timers.push(t); live.timers++;
      return t;
    };
    w.every = function (fn, ms) {
      var t = setInterval(function () { if (!w.disposed) fn(); }, ms);
      w.timers.push(t); live.timers++;
      return t;
    };
    w.cancel = function (t) {
      if (!t) return;
      clearTimeout(t); clearInterval(t);
      var i = w.timers.indexOf(t); if (i > -1) { w.timers.splice(i, 1); live.timers--; }
    };
    w.onDispose = function (fn) { w.extra.push(fn); };
    w.change = function (detail) {
      detail = detail || {};
      detail.id = w.id; detail.kind = kind;
      if (o.param) detail.param = o.param;
      fire(el, "apc:change", detail);
      APC.emit("widget:change", detail);
    };
    w.setDisabled = function (b) {
      b = !!b;
      w.disabled = b;
      cls(el, "is-disabled", b);
      if (b) { el.setAttribute("aria-disabled", "true"); el.setAttribute("data-disabled", "true"); }
      else { el.removeAttribute("aria-disabled"); el.removeAttribute("data-disabled"); }
      if (w.applyDisabled) w.applyDisabled(b);
    };
    w.dispose = function () {
      if (w.disposed) return;
      var i;
      for (i = 0; i < w.extra.length; i++) { try { w.extra[i](); } catch (e) {} }
      w.extra = [];
      w.disposed = true;
      for (i = 0; i < w.timers.length; i++) { clearTimeout(w.timers[i]); clearInterval(w.timers[i]); live.timers--; }
      w.timers = [];
      for (i = 0; i < w.offs.length; i++) { try { w.offs[i](); } catch (e2) {} }
      w.offs = [];
      live.widgets--;
      if (el.__apcW) el.__apcW = null;
    };
    return w;
  }
  function finish(w, api) {
    api = api || {};
    api.el = w.el; api.kind = w.kind; api.id = w.id;
    api.setDisabled = function (b) { w.setDisabled(b); };
    api.isDisabled = function () { return w.disabled; };
    api.dispose = w.dispose;
    w.el.__apcW = api;
    live.widgets++;
    if (w.disabled) w.setDisabled(true);
    return api;
  }
  function labelEl(w, text) {
    if (!text) return null;
    return h("span", { class: "apc-w__label", id: w.id + "-lbl", text: text });
  }

  /* ---- type-ahead (no timers: compares timestamps) -------------------------------------------- */
  function makeTypeahead() {
    var buf = "", last = 0;
    return function (ch, labels, from, skip) {
      var t = Date.now(), needle, cyc, start, k, i, n = labels.length;
      if (t - last > 700) buf = "";
      last = t;
      ch = String(ch).toLowerCase();
      buf += ch;
      cyc = buf.length > 1 && buf.split("").every(function (c) { return c === ch; });
      needle = cyc ? ch : buf;
      start = (cyc || buf.length === 1) ? from + 1 : Math.max(0, from);
      for (k = 0; k < n; k++) {
        i = (start + k + n) % n;
        if (skip && skip(i)) continue;
        if (String(labels[i]).toLowerCase().indexOf(needle) === 0) return i;
      }
      return -1;
    };
  }
  function isPrintable(e) { return e.key && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey; }

  /* ---- popup: fixed layer, positioned and flipped inside the plate (or viewport) ------------------ */
  var openPops = [];
  function boundsFor(node) {
    var vw = window.innerWidth || document.documentElement.clientWidth, vh = window.innerHeight || document.documentElement.clientHeight;
    var b = { left: 0, top: 0, right: vw, bottom: vh };
    var plate = (node && node.closest) ? node.closest(".apc-plate") : null;
    if (!plate) plate = document.querySelector(".apc-plate");
    if (plate) {
      var r = plate.getBoundingClientRect();
      b = { left: Math.max(0, r.left), top: Math.max(0, r.top), right: Math.min(vw, r.right), bottom: Math.min(vh, r.bottom) };
      if (b.right - b.left < 40 || b.bottom - b.top < 40) b = { left: 0, top: 0, right: vw, bottom: vh };
    }
    return b;
  }
  /* o: { node, anchor (element) | x,y (point), side:"below"|"right", align:"start"|"end", matchWidth,
          inside(target)->bool (extra "inside" test), keepOnAnchor (default true), onClose(refocus) } */
  function popup(o) {
    var node = o.node, closed = false, gap = 2;
    node.classList.add("apc-pop");
    node.style.visibility = "hidden";
    document.body.appendChild(node);
    function rect() {
      if (o.anchor) return o.anchor.getBoundingClientRect();
      var x = o.x || 0, y = o.y || 0;
      return { left: x, right: x, top: y, bottom: y, width: 0, height: 0 };
    }
    function place() {
      var a = rect(), b = boundsFor(o.anchor || null), x, y, pw, ph, below, above, bw = b.right - b.left, bh = b.bottom - b.top, hh;
      node.style.maxHeight = ""; node.style.maxWidth = Math.max(40, bw) + "px";
      node.style.minWidth = o.matchWidth ? Math.round(a.width) + "px" : "";
      node.style.left = "0px"; node.style.top = "0px";
      pw = node.offsetWidth; ph = node.offsetHeight;
      if (o.side === "right") {
        x = a.right;
        if (x + pw > b.right) x = a.left - pw;
        if (x < b.left) x = Math.max(b.left, b.right - pw);
        if (ph > bh) { node.style.maxHeight = Math.floor(bh) + "px"; ph = Math.min(ph, bh); }
        y = a.top;
        if (y + ph > b.bottom) y = Math.max(b.top, b.bottom - ph);
      } else {
        x = (o.align === "end") ? a.right - pw : a.left;
        x = Math.max(b.left, Math.min(x, b.right - pw));
        below = b.bottom - a.bottom - gap; above = a.top - b.top - gap;
        if (ph <= below) y = a.bottom + gap;
        else if (ph <= above) y = a.top - gap - ph;
        else if (below >= above) { hh = Math.max(40, Math.floor(below)); node.style.maxHeight = hh + "px"; y = a.bottom + gap; }
        else { hh = Math.max(40, Math.floor(above)); node.style.maxHeight = hh + "px"; y = a.top - gap - Math.min(ph, hh); }
      }
      node.style.left = Math.round(x) + "px"; node.style.top = Math.round(y) + "px";
      node.style.visibility = "";
    }
    function outside(e) {
      var t = e.target;
      if (node.contains(t)) return;
      if (o.anchor && o.anchor.contains(t) && o.keepOnAnchor !== false) return;
      if (o.inside && o.inside(t)) return;
      close(false);
    }
    function onScroll(e) { if (e.target === node || (e.target && e.target.nodeType === 1 && node.contains(e.target))) return; place(); }
    var rec = { node: node, place: place, isOpen: function () { return !closed; }, close: close };
    function close(refocus) {
      if (closed) return;
      closed = true;
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", onScroll, true);
      var i = openPops.indexOf(rec); if (i > -1) openPops.splice(i, 1);
      if (node.parentNode) node.parentNode.removeChild(node);
      live.popups--;
      if (o.onClose) o.onClose(!!refocus);
    }
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", onScroll, true);
    openPops.push(rec); live.popups++;
    place();
    return rec;
  }
  function closeAllPopups() { var l = openPops.slice(), i; for (i = l.length - 1; i >= 0; i--) l[i].close(false); }

  /* ---- parameter binding (apc.params.get / set / begin / end / reset, `param` events) -------------- */
  var binds = {}, meterSubs = {}, subscribedTo = null;
  function eachBind(fn) { var id, list, i; for (id in binds) { list = binds[id].slice(); for (i = 0; i < list.length; i++) fn(list[i]); } }
  function ensureEvents() {
    var b = APC.bridge;
    if (!b || !b.on || subscribedTo === b) return;
    subscribedTo = b;
    b.on("param", function (ev) {
      if (!ev) return;
      var id = ev.id, list, i;
      if (id === "*" || id === undefined) { eachBind(function (x) { x.refresh(); }); return; }
      list = (binds[id] || []).slice();
      for (i = 0; i < list.length; i++) list[i].onParam(ev);
    });
    b.on("preset", function () { eachBind(function (x) { x.refresh(); }); });
    b.on("meter", function (ev) {
      if (!ev || typeof ev.id !== "string") return;
      var list = (meterSubs[ev.id] || []).slice(), i;
      for (i = 0; i < list.length; i++) list[i](ev.value, ev);
    });
  }
  APC.on("params:changed", function (ev) {
    if (!ev || !ev.id) return;
    var list = (binds[ev.id] || []).slice(), i;
    for (i = 0; i < list.length; i++) list[i].refresh();
  });
  function onMeter(id, fn) {
    ensureEvents();
    (meterSubs[id] = meterSubs[id] || []).push(fn);
    return function () { var l = meterSubs[id] || [], i = l.indexOf(fn); if (i > -1) l.splice(i, 1); };
  }

  /* cb(kind, arg): "ready" (descriptor loaded) | "param" (host changed value) | "local" (we changed it) | "error" */
  function bindParam(w, id, cb) {
    var C = APC.controls;
    var b = { id: id, model: null, desc: null, value: 0, ready: false, failed: false, disposed: false, active: false, start: 0, label: "" };
    function name() { return (b.desc && b.desc.name) || w.o.label || id; }
    b.name = name;
    if (!C || !C.Model) {
      b.failed = true;
      report("APC " + w.kind + ": parameter binding needs apc-controls.js", "", "apc-widgets");
      Promise.resolve().then(function () { if (!b.disposed) cb("error"); });
    }
    function setup(d) {
      b.desc = d; b.model = new C.Model(d);
      b.value = b.model.snap(b.model.fromWire(d.value));
      b.ready = true; b.failed = false;
    }
    b.refresh = function () {
      if (!C || !C.Model) return Promise.resolve();
      return call("apc.params.get", { id: id }).then(function (d) {
        if (b.disposed) return;
        if (d && !d.error) { if (b.active) { b.desc = d; return; } setup(d); cb("ready"); }
        else { b.failed = true; cb("error", d); }
      });
    };
    b.onParam = function (ev) {
      if (b.disposed || !b.model || b.active || ev.onlyMod) return;
      if (typeof ev.value !== "undefined") {
        var v = b.model.snap(b.model.fromWire(ev.value));
        b.desc.value = ev.value;
        if (v !== b.value) { b.value = v; cb("param"); }
      }
    };
    b.begin = function (label) {
      if (!b.model || b.active) return false;
      b.active = true; b.start = b.value; b.label = label || ("Adjust " + name());
      call("apc.param.begin", { id: id });
      return true;
    };
    b.set = function (v) {
      if (!b.model) return;
      v = b.model.snap(v);
      b.value = v;
      call("apc.param.set", { id: id, value: b.model.toWire(v) }).then(function (r) {
        if (b.disposed || b.active || !r || r.error || typeof r.value === "undefined") return;
        var hv = b.model.snap(b.model.fromWire(r.value));
        if (hv !== b.value) { b.value = hv; cb("param"); }
      });
    };
    b.end = function () {
      if (!b.active) return;
      b.active = false;
      call("apc.param.end", { id: id });
      if (b.value !== b.start) APC.emit("undo:push", { label: b.label, id: id, before: b.start, after: b.value });
    };
    /* one complete host gesture around a discrete change */
    b.commit = function (v, label) {
      if (!b.model) return false;
      v = b.model.snap(v);
      if (v === b.value && !b.active) return false;
      var was = b.active;
      b.begin(label);
      b.set(v);
      cb("local");
      if (!was) b.end();
      return true;
    };
    b.reset = function () {
      if (!b.model) return;
      var before = b.value;
      b.value = b.model.snap(b.model.def);
      cb("local");
      call("apc.param.reset", { id: id }).then(function (r) {
        if (b.disposed || !r || r.error || typeof r.value === "undefined") return;
        var hv = b.model.snap(b.model.fromWire(r.value));
        if (hv !== b.value) { b.value = hv; cb("param"); }
      });
      if (before !== b.value) APC.emit("undo:push", { label: "Reset " + name(), id: id, before: before, after: b.value });
    };
    b.dispose = function () {
      if (b.disposed) return;
      if (b.active) b.end();
      b.disposed = true;
      var l = binds[id] || [], ix = l.indexOf(b);
      if (ix > -1) l.splice(ix, 1);
      live.binds--;
    };
    (binds[id] = binds[id] || []).push(b); live.binds++;
    ensureEvents();
    b.refresh();
    w.onDispose(b.dispose);
    return b;
  }

  /* ---- items (static <option> children / data-items JSON / "A|B|C") ---------------------------------- */
  function normItem(x) {
    if (x === null || x === undefined) return null;
    if (typeof x === "object") {
      var v = x.value !== undefined ? x.value : (x.id !== undefined ? x.id : x.label);
      return { value: v, label: String(x.label !== undefined ? x.label : v), disabled: !!x.disabled, title: x.title ? String(x.title) : "", icon: x.icon ? String(x.icon) : "" };
    }
    return { value: x, label: String(x), disabled: false, title: "", icon: "" };
  }
  function parseItems(el, o) {
    var out = [], j = jsonOr(o.items, null), i, it, kids, c, v;
    if (j && typeof j === "object" && j.length !== undefined) {
      for (i = 0; i < j.length; i++) { it = normItem(j[i]); if (it) out.push(it); }
    } else if (typeof o.items === "string" && o.items) {
      j = o.items.split("|");
      for (i = 0; i < j.length; i++) if (j[i].trim()) out.push(normItem(j[i].trim()));
    } else {
      kids = el.children;
      for (i = 0; i < kids.length; i++) {
        c = kids[i];
        if (c.tagName === "OPTION" || c.hasAttribute("data-value") || c.hasAttribute("data-item")) {
          v = c.hasAttribute("value") ? c.getAttribute("value") : (c.hasAttribute("data-value") ? c.getAttribute("data-value") : textOf(c));
          it = { value: v, label: textOf(c) || String(v), disabled: c.hasAttribute("disabled") || c.hasAttribute("data-disabled"), title: c.getAttribute("title") || "", icon: c.getAttribute("data-icon") || "" };
          if (c.hasAttribute("selected") || c.hasAttribute("data-selected")) it.selected = true;
          out.push(it);
        }
      }
    }
    return out;
  }
  function modelItems(m, staticItems) {
    var items = [], i, v, it;
    if (m.isChoice) { for (i = 0; i < m.choices.length; i++) items.push({ value: i, label: String(m.choices[i]), disabled: false, title: "", icon: "" }); }
    else if (m.isBool) { items = [{ value: 0, label: "Off", disabled: false, title: "", icon: "" }, { value: 1, label: "On", disabled: false, title: "", icon: "" }]; }
    else if (staticItems && staticItems.length) {
      for (i = 0; i < staticItems.length; i++) {
        v = parseFloat(staticItems[i].value);
        if (!isFinite(v)) return null;
        it = { value: v, label: staticItems[i].label, disabled: staticItems[i].disabled, title: staticItems[i].title, icon: staticItems[i].icon };
        items.push(it);
      }
    } else if (m.step && m.stepsCount() > 0 && m.stepsCount() <= 32) {
      for (i = 0; i <= m.stepsCount(); i++) { v = m.min + i * m.step; items.push({ value: v, label: m.format(v), disabled: false, title: "", icon: "" }); }
    } else return null;
    return items;
  }

  /* One-of-N choice shared by buttons/segmented, radio, dropdown, list(single).
     notify(kind): "ready" (items rebuilt) | "param" | "local" | "change" | "error" */
  function makeChoice(w, o, staticItems, notify) {
    var ch = { items: staticItems || [], index: -1, bound: !!o.param, b: null, failed: false, ready: !o.param };
    function indexOfValue(v) {
      var i, best = -1, bd = Infinity, d;
      for (i = 0; i < ch.items.length; i++) {
        d = Math.abs(Number(ch.items[i].value) - Number(v));
        if (d < bd) { bd = d; best = i; }
      }
      return best;
    }
    ch.enabled = function (i) { return i >= 0 && i < ch.items.length && !ch.items[i].disabled; };
    ch.step = function (from, d, wrap) {
      var n = ch.items.length, k, i = from;
      for (k = 0; k < n; k++) {
        i += d;
        if (i < 0 || i >= n) { if (!wrap) return -1; i = (i + n) % n; }
        if (ch.enabled(i)) return i;
      }
      return -1;
    };
    ch.first = function () { return ch.step(-1, 1, false); };
    ch.last = function () { return ch.step(ch.items.length, -1, false); };
    ch.labels = function () { var out = [], i; for (i = 0; i < ch.items.length; i++) out.push(ch.items[i].label); return out; };
    ch.select = function (i, label) {
      if (w.disabled || !ch.enabled(i) || (ch.bound && (!ch.b || !ch.b.ready))) return false;
      if (ch.bound) {
        var changed = ch.b.commit(ch.items[i].value, label);
        ch.index = indexOfValue(ch.b.value);
        if (changed) w.change({ index: ch.index, value: ch.items[ch.index] ? ch.items[ch.index].label : null });
        return changed;
      }
      if (i === ch.index) return false;
      ch.index = i;
      notify("change");
      w.change({ index: i, value: ch.items[i].value, label: ch.items[i].label });
      return true;
    };
    ch.setIndex = function (i) { if (i === ch.index || i < -1 || i >= ch.items.length) return; if (ch.bound) ch.select(i); else { ch.index = i; notify("change"); } };
    ch.selectedLabel = function () { return ch.items[ch.index] ? ch.items[ch.index].label : ""; };
    ch.selectedValue = function () { return ch.items[ch.index] ? ch.items[ch.index].value : null; };
    if (ch.bound) {
      ch.b = bindParam(w, o.param, function (kind) {
        if (kind === "ready") {
          var it = modelItems(ch.b.model, staticItems);
          if (!it) {
            ch.failed = true; ch.items = [];
            report("APC " + w.kind + ": parameter '" + o.param + "' has no choices; give it descriptor.choices, a step range or data-items", "", "apc-widgets");
            notify("error"); return;
          }
          var sig = JSON.stringify(it);
          ch.items = it; ch.ready = true; ch.failed = false;
          ch.index = indexOfValue(ch.b.value);
          if (ch.sig === sig) { notify("param"); return; }            /* a refresh (preset event) with the same items: repaint only, keep focus */
          ch.sig = sig;
          notify("ready");
        } else if (kind === "param" || kind === "local") {
          ch.index = indexOfValue(ch.b.value);
          notify(kind);
        } else if (kind === "error") { ch.failed = true; notify("error"); }
      });
    } else {
      var want = o.value, i, found = -1;
      if (want !== undefined) { for (i = 0; i < ch.items.length; i++) if (String(ch.items[i].value) === String(want) || ch.items[i].label === String(want)) { found = i; break; } }
      if (found < 0) { for (i = 0; i < ch.items.length; i++) if (ch.items[i].selected) { found = i; break; } }
      if (found < 0 && o.placeholder === undefined && want !== "") found = ch.first();
      ch.index = found;
    }
    return ch;
  }
  function markError(w, on, msg) {
    cls(w.el, "is-error", on);
    if (on) { w.el.setAttribute("aria-invalid", "true"); if (msg) w.el.setAttribute("data-error", msg); }
    else { w.el.removeAttribute("aria-invalid"); w.el.removeAttribute("data-error"); }
  }

  /* ================================================================================================
     button
     ================================================================================================ */
  function initButton(el, o) {
    var w = base(el, "button", o);
    var variant = /^(latch|primary|action)$/i.test(o.variant || "") ? o.variant.toLowerCase() : "action";
    var latch = variant === "latch";
    var label = o.label !== undefined ? o.label : textOf(el);
    var iconSlot = el.querySelector("[data-slot='icon']");
    if (iconSlot && iconSlot.parentNode === el) el.removeChild(iconSlot); else iconSlot = null;
    var btn = el.tagName === "BUTTON" ? el : h("button", { type: "button" });
    APC.dom.clear(el);
    if (btn !== el) el.appendChild(btn);
    btn.setAttribute("type", "button");
    btn.classList.add("apc-button", "apc-button--" + variant);
    if (o.ariaLabel) btn.setAttribute("aria-label", o.ariaLabel);
    else if (!label && o.title) btn.setAttribute("aria-label", o.title);
    if (o.title) btn.setAttribute("title", o.title);
    var ledNode = null, iconNode = null, labelNode = null;
    if (o.led !== undefined && o.led !== "false") {
      ledNode = h("span", { class: "apc-led apc-button__led", "aria-hidden": "true" });
      if (/^(ok|warn|error)$/.test(o.led)) ledNode.setAttribute("data-tone", o.led);
      btn.appendChild(ledNode);
    }
    if (iconSlot) { iconSlot.classList.add("apc-button__icon"); iconSlot.setAttribute("aria-hidden", "true"); btn.appendChild(iconSlot); }
    else if (o.icon) { iconNode = h("span", { class: "apc-button__icon", "aria-hidden": "true", text: o.icon }); btn.appendChild(iconNode); }
    if (label) { labelNode = h("span", { class: "apc-button__label", text: label }); btn.appendChild(labelNode); }

    var b = null, pressed = bool(o.pressed, false), held = false, justReleased = false;
    function paint() {
      if (latch) {
        btn.setAttribute("aria-pressed", pressed ? "true" : "false");
        cls(btn, "is-on", pressed);
        if (ledNode) ledNode.setAttribute("data-state", pressed ? "on" : "off");
      } else {
        cls(btn, "is-down", held);
        if (ledNode) ledNode.setAttribute("data-state", held ? "on" : "off");
      }
    }
    function emitBus(extra) {
      var d = { id: w.id, variant: variant, action: o.action || label || w.id }, k;
      if (o.param) d.param = o.param;
      for (k in (extra || {})) d[k] = extra[k];
      APC.emit("button", d);
    }
    function activate(down) {
      fire(el, "apc:click", { id: w.id, pressed: !!down });
      emitBus({ pressed: !!down });
    }
    w.applyDisabled = function (d) { btn.disabled = !!(d || (b && b.failed)); };

    if (o.param) {
      b = bindParam(w, o.param, function (kind) {
        if (kind === "error") { markError(w, true, "Parameter unavailable"); btn.disabled = true; return; }
        if (kind === "ready") { markError(w, false); btn.disabled = w.disabled; }
        if (latch) { pressed = b.value > b.model.min; paint(); }
      });
    }
    function toggle() {
      if (b) {
        if (!b.ready) return;
        b.commit(pressed ? b.model.min : b.model.max, "Toggle " + b.name());
        pressed = b.value > b.model.min;
      } else pressed = !pressed;
      paint();
      w.change({ pressed: pressed, value: pressed });
      emitBus({ pressed: pressed });
    }
    function press() {
      if (held || w.disabled || !b || !b.ready) return;
      held = true; paint();
      b.begin("Press " + b.name());
      b.set(b.model.max);
      activate(true);
    }
    function release() {
      if (!held) return;
      held = false; paint();
      b.set(b.model.min);
      b.end();
      justReleased = true;                                     /* the click that follows this gesture is already served */
      w.later(function () { justReleased = false; }, 0);
    }
    w.on(btn, "click", function (e) {
      if (w.disabled) { e.preventDefault(); return; }
      if (latch) { toggle(); return; }
      if (b) {
        if (justReleased) return;                                    /* a pointer/key press already did the work */
        press(); release(); justReleased = false;
        return;
      }
      activate(false);
    });
    if (b && !latch) {
      w.on(btn, "pointerdown", function (e) {
        if (e.button !== undefined && e.button !== 0) return;
        press();
        try { btn.setPointerCapture(e.pointerId); } catch (x) {}
      });
      w.on(btn, "pointerup", release);
      w.on(btn, "pointercancel", release);
      w.on(btn, "lostpointercapture", release);
      w.on(btn, "blur", release);
      w.on(btn, "keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (!e.repeat) press(); }
      });
      w.on(btn, "keyup", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); release(); } });
    }
    paint();
    w.onDispose(function () { if (held) release(); });
    return finish(w, {
      getPressed: function () { return pressed; },
      setPressed: function (p) { pressed = !!p; paint(); },
      setLabel: function (t) { if (!labelNode) { labelNode = h("span", { class: "apc-button__label" }); btn.appendChild(labelNode); } labelNode.textContent = t; },
      setLed: function (state) { if (ledNode) ledNode.setAttribute("data-state", state); },
      click: function () { btn.click(); },
      primary: btn,
      focus: function () { btn.focus(); }
    });
  }

  /* ================================================================================================
     buttons (segmented) and radio : one choice of N
     ================================================================================================ */
  function initGroup(el, o, kind) {
    var w = base(el, kind, o);
    var items0 = parseItems(el, o), orient = (kind === "radio" && !(o.orient || o.orientation)) ? "vertical" : dir(o), nodes = [], ch;
    APC.dom.clear(el);
    el.setAttribute("data-orient", orient);
    var lbl = labelEl(w, o.label);
    var group = h("div", { class: "apc-group apc-group--" + kind, role: "radiogroup", "data-orient": orient, "aria-orientation": orient });
    if (lbl) { el.appendChild(lbl); group.setAttribute("aria-labelledby", lbl.id); }
    else if (o.ariaLabel || o.title) group.setAttribute("aria-label", o.ariaLabel || o.title);
    el.appendChild(group);
    function tabTarget() { return ch.enabled(ch.index) ? ch.index : ch.first(); }
    function paint() {
      var t = tabTarget(), i, sel;
      for (i = 0; i < nodes.length; i++) {
        sel = i === ch.index;
        nodes[i].setAttribute("aria-checked", sel ? "true" : "false");
        cls(nodes[i], "is-selected", sel);
        nodes[i].setAttribute("tabindex", (i === t && !w.disabled) ? "0" : "-1");
        if (w.disabled || ch.items[i].disabled) nodes[i].setAttribute("aria-disabled", "true"); else nodes[i].removeAttribute("aria-disabled");
      }
    }
    function build() {
      var i, it, n;
      APC.dom.clear(group); nodes = [];
      for (i = 0; i < ch.items.length; i++) {
        it = ch.items[i];
        n = h("div", { class: kind === "radio" ? "apc-radio" : "apc-seg", role: "radio", tabindex: "-1", "aria-checked": "false", "data-i": i, title: it.title || null });
        if (kind === "radio") n.appendChild(h("span", { class: "apc-radio__box", "aria-hidden": "true" }, h("span", { class: "apc-radio__dot" })));
        else if (it.icon) n.appendChild(h("span", { class: "apc-seg__icon", "aria-hidden": "true", text: it.icon }));
        n.appendChild(h("span", { class: kind === "radio" ? "apc-radio__label" : "apc-seg__label", text: it.label }));
        group.appendChild(n); nodes.push(n);
      }
      if (ch.ready) el.removeAttribute("aria-busy");
      paint();
    }
    ch = makeChoice(w, o, items0, function (k) {
      if (k === "ready") { markError(w, false); build(); }
      else if (k === "error") { markError(w, true, "Parameter unavailable"); el.removeAttribute("aria-busy"); build(); }
      else paint();
    });
    if (ch.bound && !ch.ready) el.setAttribute("aria-busy", "true");
    w.applyDisabled = paint;
    function idxOf(t) {
      var n = t && t.closest ? t.closest("[data-i]") : null;
      return n && group.contains(n) ? parseInt(n.getAttribute("data-i"), 10) : -1;
    }
    w.on(group, "click", function (e) {
      var i = idxOf(e.target);
      if (i < 0 || w.disabled) return;
      ch.select(i);
      if (nodes[i]) { try { nodes[i].focus({ preventScroll: true }); } catch (x) { nodes[i].focus(); } }
    });
    w.on(group, "keydown", function (e) {
      if (w.disabled) return;
      var cur = idxOf(e.target), k = e.key, to = -1;
      if (cur < 0) cur = ch.index;
      if (k === "ArrowRight" || k === "ArrowDown") to = ch.step(cur, 1, true);
      else if (k === "ArrowLeft" || k === "ArrowUp") to = ch.step(cur, -1, true);
      else if (k === "Home") to = ch.first();
      else if (k === "End") to = ch.last();
      else if (k === " " || k === "Enter" || k === "Spacebar") { e.preventDefault(); if (cur >= 0) ch.select(cur); return; }
      else return;
      e.preventDefault();
      if (to >= 0) { ch.select(to); if (nodes[to]) nodes[to].focus(); }
    });
    build();
    return finish(w, {
      getValue: function () { return ch.selectedValue(); },
      getIndex: function () { return ch.index; },
      getLabel: function () { return ch.selectedLabel(); },
      setIndex: function (i) { ch.setIndex(i); },
      setItems: function (list) { if (ch.bound) return; ch.items = []; var i; for (i = 0; i < list.length; i++) ch.items.push(normItem(list[i])); if (ch.index >= ch.items.length) ch.index = ch.first(); build(); },
      primary: group,
      focus: function () { var t = tabTarget(); if (nodes[t]) nodes[t].focus(); }
    });
  }

  /* ================================================================================================
     checkbox
     ================================================================================================ */
  function tickSvg() {
    var s = svgEl("svg", { "class": "apc-check__tick", viewBox: "0 0 16 16", "aria-hidden": "true", focusable: "false" });
    s.appendChild(svgEl("path", { "class": "apc-check__mark", d: "M3.5 8.5 L6.75 11.75 L12.5 4.75" }));
    s.appendChild(svgEl("path", { "class": "apc-check__dash", d: "M4 8 L12 8" }));
    return s;
  }
  function initCheckbox(el, o) {
    var w = base(el, "checkbox", o);
    var text = o.label !== undefined ? o.label : textOf(el);
    APC.dom.clear(el);
    var lab = h("span", { class: "apc-check__label", id: w.id + "-lbl", text: text });
    var ctl = h("div", { class: "apc-check", role: "checkbox", tabindex: "0", "aria-checked": "false" },
      h("span", { class: "apc-check__box", "aria-hidden": "true" }, tickSvg()), lab);
    if (text) ctl.setAttribute("aria-labelledby", lab.id); else if (o.ariaLabel) ctl.setAttribute("aria-label", o.ariaLabel);
    if (o.title) ctl.setAttribute("title", o.title);
    el.appendChild(ctl);
    var checked = bool(o.checked, false), mixed = bool(o.indeterminate, false), b = null;
    function paint() {
      ctl.setAttribute("aria-checked", mixed ? "mixed" : (checked ? "true" : "false"));
      cls(ctl, "is-checked", checked && !mixed); cls(ctl, "is-mixed", mixed);
    }
    w.applyDisabled = function (d) { ctl.setAttribute("tabindex", d ? "-1" : "0"); if (d) ctl.setAttribute("aria-disabled", "true"); else ctl.removeAttribute("aria-disabled"); };
    if (o.param) {
      el.setAttribute("aria-busy", "true");
      b = bindParam(w, o.param, function (kind) {
        if (kind === "error") { markError(w, true, "Parameter unavailable"); el.removeAttribute("aria-busy"); return; }
        if (kind === "ready") { markError(w, false); el.removeAttribute("aria-busy"); mixed = false; }
        checked = b.value > b.model.min; paint();
      });
    }
    function toggle() {
      if (w.disabled) return;
      if (b) {
        if (!b.ready) return;
        b.commit(checked ? b.model.min : b.model.max, "Toggle " + b.name());
        checked = b.value > b.model.min;
      } else { checked = mixed ? true : !checked; mixed = false; }
      paint();
      w.change({ checked: checked, value: checked });
    }
    w.on(ctl, "click", toggle);
    w.on(ctl, "keydown", function (e) { if (e.key === " " || e.key === "Spacebar") { e.preventDefault(); toggle(); } });
    paint();
    return finish(w, {
      isChecked: function () { return checked; },
      setChecked: function (v) { checked = !!v; mixed = false; paint(); },
      primary: ctl,
      focus: function () { ctl.focus(); }
    });
  }

  /* ================================================================================================
     dropdown : closed field + popup listbox (select-only combobox pattern)
     ================================================================================================ */
  function chevron(cname) {
    var s = svgEl("svg", { "class": cname || "apc-chev", viewBox: "0 0 16 16", "aria-hidden": "true", focusable: "false" });
    s.appendChild(svgEl("path", { d: "M3.5 6 L8 10.5 L12.5 6" }));
    return s;
  }
  function initDropdown(el, o) {
    var w = base(el, "dropdown", o);
    var items0 = parseItems(el, o), searchable = bool(o.searchable, false), ch;
    APC.dom.clear(el);
    var lbl = labelEl(w, o.label);
    var valueNode = h("span", { class: "apc-dd__value", id: w.id + "-val" });
    var trigger = h("div", { class: "apc-dd", role: "combobox", tabindex: "0", "aria-haspopup": "listbox", "aria-expanded": "false", "aria-controls": w.id + "-list" },
      valueNode, h("span", { class: "apc-dd__caret", "aria-hidden": "true" }, chevron("apc-chev")));
    if (lbl) { el.appendChild(lbl); trigger.setAttribute("aria-labelledby", lbl.id + " " + valueNode.id); }
    else trigger.setAttribute("aria-label", o.ariaLabel || o.title || "Choose");
    el.appendChild(trigger);
    var pop = null, listNode = null, search = null, optNodes = [], visible = [], active = -1, ta = makeTypeahead();

    function paintValue() {
      var t = ch.index >= 0 ? ch.selectedLabel() : (o.placeholder || "");
      if (ch.bound && !ch.ready) t = "—";
      valueNode.textContent = t || " ";
      cls(valueNode, "is-placeholder", ch.index < 0);
    }
    function target() { return search || trigger; }
    function setActive(i) {
      if (active > -1 && optNodes[active]) { optNodes[active].classList.remove("is-active"); }
      active = i;
      if (i > -1 && optNodes[i]) {
        optNodes[i].classList.add("is-active");
        target().setAttribute("aria-activedescendant", optNodes[i].id);
        if (optNodes[i].scrollIntoView) optNodes[i].scrollIntoView({ block: "nearest" });
      } else target().removeAttribute("aria-activedescendant");
    }
    function firstVisible() { var k; for (k = 0; k < visible.length; k++) if (ch.enabled(visible[k])) return visible[k]; return -1; }
    function stepActive(d) {
      var pos = visible.indexOf(active), k, i;
      for (k = 1; k <= visible.length; k++) {
        i = pos + d * k;
        if (i < 0 || i >= visible.length) return;
        if (ch.enabled(visible[i])) { setActive(visible[i]); return; }
      }
    }
    function buildOptions(q) {
      APC.dom.clear(listNode); optNodes = []; visible = [];
      var i, it, n, ql = (q || "").toLowerCase();
      for (i = 0; i < ch.items.length; i++) {
        it = ch.items[i];
        if (ql && it.label.toLowerCase().indexOf(ql) < 0) continue;
        n = h("div", { class: "apc-opt", role: "option", id: w.id + "-o" + i, "aria-selected": i === ch.index ? "true" : "false", "data-i": i, title: it.title || null, text: it.label });
        if (it.disabled) n.setAttribute("aria-disabled", "true");
        listNode.appendChild(n); optNodes[i] = n; visible.push(i);
      }
      if (!visible.length) listNode.appendChild(h("div", { class: "apc-opt apc-opt--empty", role: "presentation", text: "No match" }));
    }
    function close(refocus) { if (pop) pop.close(refocus); }
    function pick(i) {
      if (!ch.enabled(i)) return;
      ch.select(i);
      close(true);
    }
    function open() {
      if (pop || w.disabled || !ch.items.length) return;
      var popNode = h("div", { class: "apc-pop--dd" });
      listNode = h("div", { class: "apc-pop__list", role: "listbox", id: w.id + "-list", tabindex: "-1" });
      if (lbl) listNode.setAttribute("aria-labelledby", lbl.id);
      if (searchable) {
        search = h("input", { class: "apc-pop__search", type: "text", role: "searchbox", autocomplete: "off", spellcheck: "false", "aria-label": "Filter " + (o.label || "list"), "aria-controls": listNode.id, placeholder: "Filter…" });
        popNode.appendChild(search);
        search.addEventListener("input", function () { buildOptions(search.value); setActive(firstVisible()); });
        search.addEventListener("keydown", onKey);
      }
      popNode.appendChild(listNode);
      buildOptions("");
      listNode.addEventListener("mousedown", function (e) { if (!searchable) e.preventDefault(); });
      listNode.addEventListener("click", function (e) {
        var n = e.target.closest ? e.target.closest("[data-i]") : null;
        if (n) pick(parseInt(n.getAttribute("data-i"), 10));
      });
      listNode.addEventListener("pointerover", function (e) {
        var n = e.target.closest ? e.target.closest("[data-i]") : null;
        if (n) { var i = parseInt(n.getAttribute("data-i"), 10); if (ch.enabled(i) && i !== active) setActive(i); }
      });
      pop = popup({ node: popNode, anchor: trigger, matchWidth: true, onClose: function (refocus) {
        pop = null; search = null; listNode = null; optNodes = []; visible = []; active = -1;
        trigger.setAttribute("aria-expanded", "false"); trigger.removeAttribute("aria-activedescendant");
        if (refocus && !w.disposed) trigger.focus();
      } });
      trigger.setAttribute("aria-expanded", "true");
      setActive(ch.enabled(ch.index) ? ch.index : ch.first());
      if (search) search.focus();
    }
    function onKey(e) {
      if (w.disabled) return;
      var k = e.key, fromSearch = e.target === search, i;
      if (!pop) {
        if (k === "ArrowDown" || k === "ArrowUp" || k === "Enter" || k === " " || k === "Spacebar") { e.preventDefault(); open(); return; }
        if (k === "Home" || k === "End") { e.preventDefault(); open(); if (pop) setActive(k === "Home" ? ch.first() : ch.last()); return; }
        if (isPrintable(e)) {
          e.preventDefault(); open();
          if (pop && search) { search.value = e.key; buildOptions(e.key); setActive(firstVisible()); }
          else if (pop) { i = ta(e.key, ch.labels(), ch.index, function (x) { return !ch.enabled(x); }); if (i > -1) setActive(i); }
        }
        return;
      }
      e.stopPropagation();
      if (k === "Escape") { e.preventDefault(); close(true); }
      else if (k === "Tab") close(false);
      else if (k === "ArrowDown") { e.preventDefault(); stepActive(1); }
      else if (k === "ArrowUp") { e.preventDefault(); stepActive(-1); }
      else if (k === "PageDown") { e.preventDefault(); for (i = 0; i < 5; i++) stepActive(1); }
      else if (k === "PageUp") { e.preventDefault(); for (i = 0; i < 5; i++) stepActive(-1); }
      else if (k === "Home") { e.preventDefault(); setActive(firstVisible()); }
      else if (k === "End") { e.preventDefault(); for (i = visible.length - 1; i >= 0; i--) if (ch.enabled(visible[i])) { setActive(visible[i]); break; } }
      else if (k === "Enter" || ((k === " " || k === "Spacebar") && !fromSearch)) { e.preventDefault(); if (active > -1) pick(active); }
      else if (!fromSearch && isPrintable(e)) {
        e.preventDefault();
        i = ta(e.key, ch.labels(), active, function (x) { return !ch.enabled(x); });
        if (i > -1) setActive(i);
      }
    }
    ch = makeChoice(w, o, items0, function (kind) {
      if (kind === "error") { markError(w, true, "Parameter unavailable"); el.removeAttribute("aria-busy"); close(false); }
      else if (kind === "ready") { markError(w, false); el.removeAttribute("aria-busy"); close(false); }
      else if (pop) {
        var i; for (i = 0; i < optNodes.length; i++) if (optNodes[i]) optNodes[i].setAttribute("aria-selected", i === ch.index ? "true" : "false");
      }
      paintValue();
    });
    if (ch.bound && !ch.ready) el.setAttribute("aria-busy", "true");
    paintValue();
    w.applyDisabled = function (d) { trigger.setAttribute("tabindex", d ? "-1" : "0"); if (d) { trigger.setAttribute("aria-disabled", "true"); close(false); } else trigger.removeAttribute("aria-disabled"); };
    w.on(trigger, "click", function () { if (w.disabled) return; if (pop) close(true); else open(); });
    w.on(trigger, "keydown", onKey);
    w.on(trigger, "blur", function (e) { if (pop && !search && !(e.relatedTarget && pop.node.contains(e.relatedTarget))) close(false); });
    w.onDispose(function () { close(false); });
    return finish(w, {
      getValue: function () { return ch.selectedValue(); },
      getIndex: function () { return ch.index; },
      getLabel: function () { return ch.selectedLabel(); },
      setIndex: function (i) { ch.setIndex(i); },
      open: open, close: function () { close(false); }, isOpen: function () { return !!pop; }, primary: trigger,
      setItems: function (list) { if (ch.bound) return; ch.items = []; var i; for (i = 0; i < list.length; i++) ch.items.push(normItem(list[i])); if (ch.index >= ch.items.length) ch.index = ch.first(); paintValue(); },
      focus: function () { trigger.focus(); }
    });
  }

  /* ================================================================================================
     list : listbox, single or multi select
     ================================================================================================ */
  function initList(el, o) {
    var w = base(el, "list", o);
    var multi = bool(o.multiple, false), items0 = parseItems(el, o), rows = [], sel = [], active = -1, anchor = -1, ta = makeTypeahead();
    var chOpts = multi ? { placeholder: "" } : o;
    APC.dom.clear(el);
    var lbl = labelEl(w, o.label);
    var list = h("div", { class: "apc-list", role: "listbox", tabindex: "0", "aria-multiselectable": multi ? "true" : "false" });
    if (lbl) { el.appendChild(lbl); list.setAttribute("aria-labelledby", lbl.id); }
    else if (o.ariaLabel || o.title) list.setAttribute("aria-label", o.ariaLabel || o.title);
    if (o.rows) { list.style.setProperty("--apc-list-rows", String(numOr(o.rows, 6))); list.classList.add("has-rows"); }
    el.appendChild(list);
    if (multi && o.param) report("APC list: data-param is only supported for single-select lists", "", "apc-widgets");
    var ch = makeChoice(w, chOpts, items0, function (kind) {
      if (kind === "ready") { markError(w, false); el.removeAttribute("aria-busy"); build(); }
      else if (kind === "error") { markError(w, true, "Parameter unavailable"); el.removeAttribute("aria-busy"); build(); }
      else { if (!multi) active = ch.index; paint(); }
    });
    if (multi) {
      var want = jsonOr(o.value, null), wl = (want && want.length !== undefined && typeof want !== "string") ? want : (typeof o.value === "string" && o.value ? o.value.split(",") : []), i0, j0;
      for (i0 = 0; i0 < ch.items.length; i0++) {
        sel[i0] = !!ch.items[i0].selected;
        for (j0 = 0; j0 < wl.length; j0++) if (String(wl[j0]) === String(ch.items[i0].value)) sel[i0] = true;
      }
    }
    if (ch.bound && !ch.ready) el.setAttribute("aria-busy", "true");
    function isSel(i) { return multi ? !!sel[i] : i === ch.index; }
    function paint() {
      var i;
      for (i = 0; i < rows.length; i++) {
        rows[i].setAttribute("aria-selected", isSel(i) ? "true" : "false");
        cls(rows[i], "is-selected", isSel(i)); cls(rows[i], "is-active", i === active);
        if (ch.items[i].disabled || w.disabled) rows[i].setAttribute("aria-disabled", "true"); else rows[i].removeAttribute("aria-disabled");
      }
      if (active > -1 && rows[active]) list.setAttribute("aria-activedescendant", rows[active].id); else list.removeAttribute("aria-activedescendant");
    }
    function build() {
      var i, it;
      APC.dom.clear(list); rows = [];
      for (i = 0; i < ch.items.length; i++) {
        it = ch.items[i];
        rows[i] = h("div", { class: "apc-li", role: "option", id: w.id + "-o" + i, "aria-selected": "false", "data-i": i, title: it.title || null },
          multi ? h("span", { class: "apc-li__box", "aria-hidden": "true" }, tickSvg()) : null, h("span", { class: "apc-li__label", text: it.label }));
        list.appendChild(rows[i]);
      }
      if (active < 0 || active >= rows.length) active = multi ? ch.first() : (ch.index > -1 ? ch.index : ch.first());
      paint();
    }
    function reveal(i) { if (rows[i] && rows[i].scrollIntoView) rows[i].scrollIntoView({ block: "nearest" }); }
    function values() { var out = [], i; for (i = 0; i < sel.length; i++) if (sel[i]) out.push(ch.items[i].value); return out; }
    function indices() { var out = [], i; if (!multi) return ch.index > -1 ? [ch.index] : []; for (i = 0; i < sel.length; i++) if (sel[i]) out.push(i); return out; }
    function changed() { w.change({ value: multi ? values() : ch.selectedValue(), indices: indices() }); }
    function go(i, extend, toggleOnly) {
      if (!ch.enabled(i) || w.disabled) return;
      var lo, hi, k;
      active = i; reveal(i);
      if (!multi) { ch.select(i); paint(); return; }
      if (extend && anchor > -1) {
        lo = Math.min(anchor, i); hi = Math.max(anchor, i);
        for (k = 0; k < ch.items.length; k++) sel[k] = (k >= lo && k <= hi && ch.enabled(k));
        changed();
      } else if (toggleOnly) { sel[i] = !sel[i]; anchor = i; changed(); }
      paint();
    }
    w.on(list, "click", function (e) {
      var n = e.target.closest ? e.target.closest("[data-i]") : null;
      if (!n || w.disabled) return;
      var i = parseInt(n.getAttribute("data-i"), 10);
      try { list.focus({ preventScroll: true }); } catch (x) { list.focus(); }
      if (multi) go(i, e.shiftKey, !e.shiftKey); else go(i, false, false);
    });
    w.on(list, "dblclick", function (e) {
      var n = e.target.closest ? e.target.closest("[data-i]") : null;
      if (n && !w.disabled) fire(el, "apc:activate", { id: w.id, index: parseInt(n.getAttribute("data-i"), 10) });
    });
    w.on(list, "keydown", function (e) {
      if (w.disabled) return;
      var k = e.key, to = -1, i, nx;
      var from = active > -1 ? active : (ch.index > -1 ? ch.index : -1);
      if (k === "ArrowDown") to = ch.step(from, 1, false);
      else if (k === "ArrowUp") to = ch.step(from < 0 ? ch.items.length : from, -1, false);
      else if (k === "Home") to = ch.first();
      else if (k === "End") to = ch.last();
      else if (k === "PageDown") { to = from; for (i = 0; i < 5; i++) { nx = ch.step(to, 1, false); if (nx < 0) break; to = nx; } }
      else if (k === "PageUp") { to = from; for (i = 0; i < 5; i++) { nx = ch.step(to, -1, false); if (nx < 0) break; to = nx; } }
      else if (k === " " || k === "Spacebar") { e.preventDefault(); if (active > -1) go(active, false, multi); return; }
      else if (k === "Enter") { e.preventDefault(); if (active > -1) fire(el, "apc:activate", { id: w.id, index: active }); return; }
      else if ((k === "a" || k === "A") && (e.ctrlKey || e.metaKey) && multi) {
        e.preventDefault(); for (i = 0; i < ch.items.length; i++) sel[i] = ch.enabled(i); changed(); paint(); return;
      }
      else if (isPrintable(e)) {
        e.preventDefault();
        to = ta(e.key, ch.labels(), active, function (x) { return !ch.enabled(x); });
        if (to < 0) return;
      } else return;
      e.preventDefault();
      if (to < 0 || to === from) return;
      if (multi && e.shiftKey) { if (anchor < 0) anchor = from < 0 ? to : from; go(to, true, false); }
      else { if (multi) anchor = to; go(to, false, false); }
    });
    w.applyDisabled = paint;
    build();
    return finish(w, {
      getValue: function () { return multi ? values() : ch.selectedValue(); },
      getIndices: indices, primary: list,
      setValue: function (v) {
        var i;
        if (multi) { for (i = 0; i < ch.items.length; i++) sel[i] = (v || []).map(String).indexOf(String(ch.items[i].value)) > -1; paint(); }
        else for (i = 0; i < ch.items.length; i++) if (String(ch.items[i].value) === String(v)) { ch.setIndex(i); break; }
      },
      setItems: function (listItems) {
        if (ch.bound) return;
        ch.items = []; sel = []; var i; for (i = 0; i < listItems.length; i++) ch.items.push(normItem(listItems[i]));
        if (ch.index >= ch.items.length) ch.index = -1;
        active = -1; build();
      },
      focus: function () { list.focus(); }
    });
  }

  /* ================================================================================================
     menu : popup / anchor menu (items, separators, checkmarks, disabled, shortcut hints, one submenu level)
     ================================================================================================ */
  function normMenuItems(arr) {
    var out = [], i, x;
    for (i = 0; i < (arr || []).length; i++) {
      x = arr[i];
      if (x === "-" || (x && x.separator)) { out.push({ separator: true }); continue; }
      if (x === null || x === undefined) continue;
      if (typeof x !== "object") x = { label: String(x) };
      out.push({
        id: x.id !== undefined ? x.id : x.label, label: String(x.label !== undefined ? x.label : x.id),
        shortcut: x.shortcut ? String(x.shortcut) : "", checked: x.checked === undefined ? undefined : !!x.checked,
        disabled: !!x.disabled, title: x.title ? String(x.title) : "", items: x.items ? normMenuItems(x.items) : null
      });
    }
    return out;
  }
  function menuItemsFromDom(root) {
    var out = [], kids = root.children, i, c, it, sub;
    for (i = 0; i < kids.length; i++) {
      c = kids[i];
      if (c.tagName === "HR" || c.hasAttribute("data-separator")) { out.push({ separator: true }); continue; }
      it = {
        id: c.getAttribute("data-id") || c.id || (c.getAttribute("data-label") || ownText(c) || textOf(c)),
        label: c.getAttribute("data-label") || ownText(c) || textOf(c),
        shortcut: c.getAttribute("data-shortcut") || "",
        checked: c.hasAttribute("data-checked") ? bool(c.getAttribute("data-checked"), true) : undefined,
        disabled: c.hasAttribute("data-disabled") || c.hasAttribute("disabled"), title: c.getAttribute("title") || "", items: null
      };
      if (c.children.length) { sub = menuItemsFromDom(c); if (sub.length) it.items = sub; }
      out.push(it);
    }
    return out;
  }
  /* opts: { anchor|x,y, side, label, focus:"first"|"last"|"none", parentRow, root, onselect(item), onClose(refocus) } -> { node, close(refocus), isOpen() } */
  function openMenuPopup(items, opts) {
    var node = h("div", { class: "apc-menu2", role: "menu", tabindex: "-1" });
    if (opts.label) node.setAttribute("aria-label", opts.label);
    var rows = [], subM = null, ta = makeTypeahead(), rec, anyCheck = false, i, m;
    for (i = 0; i < items.length; i++) if (items[i].checked !== undefined) anyCheck = true;
    function rootClose(refocus) { if (opts.root) opts.root.close(refocus); else m.close(refocus); }
    for (i = 0; i < items.length; i++) {
      (function (it, ix) {
        if (it.separator) { node.appendChild(h("div", { class: "apc-mi-sep", role: "separator" })); return; }
        var row = h("div", { class: "apc-mi", role: it.checked !== undefined ? "menuitemcheckbox" : "menuitem", tabindex: "-1", "data-i": ix, title: it.title || null },
          h("span", { class: "apc-mi__check", "aria-hidden": "true" }, anyCheck ? tickSvg() : null),
          h("span", { class: "apc-mi__label", text: it.label }),
          it.shortcut ? h("span", { class: "apc-mi__key", text: it.shortcut }) : null,
          it.items ? h("span", { class: "apc-mi__sub", "aria-hidden": "true" }, chevron("apc-chev apc-chev--right")) : null);
        if (it.checked !== undefined) { row.setAttribute("aria-checked", it.checked ? "true" : "false"); cls(row, "is-checked", it.checked); }
        if (it.disabled) row.setAttribute("aria-disabled", "true");
        if (it.items) { row.setAttribute("aria-haspopup", "menu"); row.setAttribute("aria-expanded", "false"); }
        node.appendChild(row); rows[ix] = row;
      })(items[i], i);
    }
    function ok(ix) { return !!rows[ix] && !items[ix].disabled; }
    function step(from, d) {
      var n = items.length, k, ix = from;
      for (k = 0; k < n; k++) { ix = (ix + d + n) % n; if (ok(ix)) return ix; }
      return -1;
    }
    function closeSub() {
      if (subM) { var s = subM; subM = null; s.close(false); }
      var j; for (j = 0; j < rows.length; j++) if (rows[j] && items[j].items) rows[j].setAttribute("aria-expanded", "false");
    }
    function openSub(ix, focusFirst) {
      closeSub();
      if (!ok(ix) || !items[ix].items) return;
      rows[ix].setAttribute("aria-expanded", "true");
      var mine = null;
      mine = openMenuPopup(items[ix].items, { anchor: rows[ix], side: "right", label: items[ix].label, focus: focusFirst ? "first" : "none",
        parentRow: rows[ix], root: opts.root || m, onselect: opts.onselect, onClose: function (refocus) {
          if (subM === mine) subM = null;
          rows[ix].setAttribute("aria-expanded", "false");
          if (refocus && rows[ix]) rows[ix].focus();
        } });
      subM = mine;
    }
    function activate(ix) {
      if (!ok(ix)) return;
      var it = items[ix];
      if (it.items) { openSub(ix, true); return; }
      if (it.checked !== undefined) { it.checked = !it.checked; rows[ix].setAttribute("aria-checked", it.checked ? "true" : "false"); cls(rows[ix], "is-checked", it.checked); }
      rootClose(true);
      if (opts.onselect) opts.onselect(it);
    }
    function idxOf(t) { var n = t && t.closest ? t.closest(".apc-mi") : null; return n && node.contains(n) ? parseInt(n.getAttribute("data-i"), 10) : -1; }
    node.addEventListener("click", function (e) { var ix = idxOf(e.target); if (ix > -1) activate(ix); });
    node.addEventListener("pointerover", function (e) {
      var ix = idxOf(e.target);
      if (ix < 0 || !ok(ix)) return;
      if (document.activeElement !== rows[ix]) rows[ix].focus();
      if (items[ix].items) { if (!subM) openSub(ix, false); } else if (subM) closeSub();
    });
    node.addEventListener("keydown", function (e) {
      var cur = idxOf(e.target), k = e.key, to;
      if (k === "ArrowDown") { to = step(cur < 0 ? -1 : cur, 1); if (to > -1) rows[to].focus(); }
      else if (k === "ArrowUp") { to = step(cur < 0 ? 0 : cur, -1); if (to > -1) rows[to].focus(); }
      else if (k === "Home") { to = step(-1, 1); if (to > -1) rows[to].focus(); }
      else if (k === "End") { to = step(0, -1); if (to > -1) rows[to].focus(); }
      else if (k === "ArrowRight") { if (cur > -1 && items[cur].items) openSub(cur, true); else return; }
      else if (k === "ArrowLeft") { if (opts.parentRow) m.close(true); else return; }
      else if (k === "Enter" || k === " " || k === "Spacebar") { if (cur > -1) activate(cur); }
      else if (k === "Escape") { m.close(true); }
      else if (k === "Tab") { rootClose(false); return; }
      else if (isPrintable(e)) {
        to = ta(e.key, items.map(function (x) { return x.label || ""; }), cur, function (x) { return !ok(x); });
        if (to < 0) return;
        rows[to].focus();
      } else return;
      e.preventDefault(); e.stopPropagation();
    });
    m = { node: node, items: items, isOpen: function () { return !!rec && rec.isOpen(); }, close: function (refocus) { closeSub(); if (rec) rec.close(refocus); } };
    rec = popup({ node: node, anchor: opts.anchor || null, x: opts.x, y: opts.y, side: opts.side, align: opts.align,
      inside: function (t) { return !!(subM && subM.node.contains(t)) || (opts.parentRow && opts.parentRow.contains(t)); },
      onClose: function (refocus) { if (subM) { var s = subM; subM = null; s.close(false); } if (opts.onClose) opts.onClose(refocus); } });
    var f;
    if (opts.focus === "first") { f = step(-1, 1); if (f > -1) rows[f].focus(); else node.focus(); }
    else if (opts.focus === "last") { f = step(0, -1); if (f > -1) rows[f].focus(); else node.focus(); }
    else if (opts.focus !== "none") node.focus();
    return m;
  }
  function initMenu(el, o) {
    var w = base(el, "menu", o);
    var items = o.items ? normMenuItems(jsonOr(o.items, [])) : menuItemsFromDom(el);
    APC.dom.clear(el);
    var trig = null, current = null, api;
    if (o.trigger !== "none") {
      trig = h("button", { type: "button", class: "apc-button apc-menu-btn", "aria-haspopup": "menu", "aria-expanded": "false" },
        h("span", { class: "apc-button__label", text: o.label || "Menu" }), h("span", { class: "apc-menu-btn__caret", "aria-hidden": "true" }, chevron("apc-chev")));
      if (o.title) trig.setAttribute("title", o.title);
      el.appendChild(trig);
    }
    function deliver(it) {
      var item = { id: it.id, label: it.label, checked: it.checked, shortcut: it.shortcut };
      var d = { id: w.id, item: item };
      if (typeof api.onselect === "function") { try { api.onselect(item); } catch (e) { report("menu onselect failed: " + e, e, "menu"); } }
      if (o.onselect && typeof window[o.onselect] === "function") { try { window[o.onselect](item, d); } catch (e2) { report("menu onselect failed: " + e2, e2, "menu"); } }
      fire(el, "apc:select", d);
      APC.emit("menu", d);
    }
    function close(refocus) { if (current) current.close(refocus); }
    function open(opts) {
      if (w.disabled) return null;
      close(false);
      opts = opts || {};
      current = openMenuPopup(items, { anchor: opts.x !== undefined ? null : (trig || el), x: opts.x, y: opts.y, label: o.label, focus: opts.focus || "first",
        onselect: deliver, onClose: function (refocus) {
          current = null;
          if (trig) { trig.setAttribute("aria-expanded", "false"); if (refocus && !w.disposed) trig.focus(); }
        } });
      if (trig) trig.setAttribute("aria-expanded", "true");
      return current;
    }
    if (trig) {
      w.on(trig, "click", function (e) { if (w.disabled) return; if (current) close(true); else open({ focus: e.detail === 0 ? "first" : "none" }); });
      w.on(trig, "keydown", function (e) {
        if (w.disabled) return;
        if (e.key === "ArrowDown") { e.preventDefault(); open({ focus: "first" }); }
        else if (e.key === "ArrowUp") { e.preventDefault(); open({ focus: "last" }); }
      });
    }
    if (o.context !== undefined && o.context !== "false") {
      var area = (o.context === "" || o.context === "true" || o.context === "parent") ? el.parentElement : document.querySelector(o.context);
      if (area) {
        w.on(area, "contextmenu", function (e) { e.preventDefault(); open({ x: e.clientX, y: e.clientY, focus: "none" }); });
        w.on(area, "keydown", function (e) {
          if (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) {
            e.preventDefault();
            var r = area.getBoundingClientRect();
            open({ x: r.left + r.width / 2, y: r.top + r.height / 2, focus: "first" });
          }
        });
      }
    }
    w.applyDisabled = function (d) { if (trig) trig.disabled = d; if (d) close(false); };
    w.onDispose(function () { close(false); });
    api = { onselect: null, open: function (opts) { return open(opts); }, openAt: function (x, y) { return open({ x: x, y: y, focus: "none" }); }, close: function () { close(false); },
      isOpen: function () { return !!current; }, setItems: function (list) { items = normMenuItems(list); }, getItems: function () { return items; } };
    return finish(w, api);
  }

  /* ================================================================================================
     tabs
     ================================================================================================ */
  function initTabs(el, o) {
    var w = base(el, "tabs", o);
    var orient = dir(o), kids = Array.prototype.slice.call(el.children).filter(function (c) { return c.hasAttribute("data-tab"); });
    var tabs = [], panels = kids, cur = -1, i, id, t;
    el.setAttribute("data-orient", orient);
    var list = h("div", { class: "apc-tablist", role: "tablist", "aria-orientation": orient });
    if (o.label || o.ariaLabel) list.setAttribute("aria-label", o.label || o.ariaLabel);
    var wrap = h("div", { class: "apc-tabpanels" });
    el.insertBefore(wrap, el.firstChild); el.insertBefore(list, el.firstChild);
    var wantV = o.value, start = -1;
    for (i = 0; i < kids.length; i++) {
      id = w.id + "-t" + i;
      kids[i].id = kids[i].id || (id + "p");
      t = h("div", { class: "apc-tab", role: "tab", id: id, tabindex: "-1", "aria-selected": "false", "aria-controls": kids[i].id, "data-i": i, text: kids[i].getAttribute("data-tab") });
      if (kids[i].hasAttribute("data-disabled")) t.setAttribute("aria-disabled", "true");
      tabs.push(t); list.appendChild(t);
      kids[i].setAttribute("role", "tabpanel"); kids[i].setAttribute("aria-labelledby", id);
      kids[i].classList.add("apc-tabpanel"); kids[i].hidden = true;
      wrap.appendChild(kids[i]);
      if (wantV !== undefined && (String(i) === String(wantV) || kids[i].getAttribute("data-tab") === wantV || kids[i].id === wantV)) start = i;
      if (start < 0 && kids[i].hasAttribute("data-selected")) start = i;
    }
    function enabled(i2) { return i2 > -1 && i2 < tabs.length && !tabs[i2].hasAttribute("aria-disabled"); }
    function stepTab(from, d) { var n = tabs.length, k, ix = from; for (k = 0; k < n; k++) { ix = (ix + d + n) % n; if (enabled(ix)) return ix; } return -1; }
    function show(ix, silent) {
      if (!enabled(ix) || w.disabled) return false;
      var changed = ix !== cur, j;
      cur = ix;
      for (j = 0; j < tabs.length; j++) {
        tabs[j].setAttribute("aria-selected", j === ix ? "true" : "false");
        tabs[j].setAttribute("tabindex", j === ix ? "0" : "-1");
        cls(tabs[j], "is-selected", j === ix);
        panels[j].hidden = j !== ix;
      }
      if (changed && !silent) w.change({ index: ix, value: panels[ix].getAttribute("data-tab"), panel: panels[ix].id });
      return changed;
    }
    w.on(list, "click", function (e) {
      var n = e.target.closest ? e.target.closest("[data-i]") : null;
      if (n && list.contains(n)) { var ix = parseInt(n.getAttribute("data-i"), 10); show(ix); if (enabled(ix)) tabs[ix].focus(); }
    });
    w.on(list, "keydown", function (e) {
      if (w.disabled) return;
      var k = e.key, nxt = orient === "vertical" ? "ArrowDown" : "ArrowRight", prv = orient === "vertical" ? "ArrowUp" : "ArrowLeft", to = -1;
      var from = cur;
      var n = e.target.closest ? e.target.closest("[data-i]") : null;
      if (n) from = parseInt(n.getAttribute("data-i"), 10);
      if (k === nxt) to = stepTab(from, 1);
      else if (k === prv) to = stepTab(from, -1);
      else if (k === "Home") to = stepTab(-1, 1);
      else if (k === "End") to = stepTab(0, -1);
      else return;
      e.preventDefault();
      if (to > -1) { show(to); tabs[to].focus(); }
    });
    w.applyDisabled = function (d) { var j; for (j = 0; j < tabs.length; j++) tabs[j].setAttribute("tabindex", (!d && j === cur) ? "0" : "-1"); };
    if (start < 0) start = stepTab(-1, 1);
    show(start, true);
    return finish(w, {
      select: function (ix) { return show(ix); }, getIndex: function () { return cur; }, primary: list,
      getValue: function () { return cur > -1 ? panels[cur].getAttribute("data-tab") : null; },
      setTabDisabled: function (ix, d) { if (tabs[ix]) { if (d) tabs[ix].setAttribute("aria-disabled", "true"); else tabs[ix].removeAttribute("aria-disabled"); } },
      focus: function () { if (tabs[cur]) tabs[cur].focus(); }
    });
  }

  /* ================================================================================================
     textfield
     ================================================================================================ */
  function initTextfield(el, o) {
    var w = base(el, "textfield", o);
    var initial = o.value !== undefined ? o.value : "";
    var initialError = o.error || "";
    APC.dom.clear(el);
    var type = /^(text|search|password|email|url)$/.test(o.type || "") ? o.type : "text";
    var input = h("input", { class: "apc-input", type: type, id: w.id + "-in", autocomplete: "off", autocapitalize: "off", spellcheck: "false",
      placeholder: o.placeholder || null, maxlength: o.maxlength || null, "aria-describedby": w.id + "-msg" });
    var lbl = o.label ? h("label", { class: "apc-w__label", id: w.id + "-lbl", "for": input.id, text: o.label }) : null;
    var msg = h("div", { class: "apc-w__msg", id: w.id + "-msg", "aria-live": "polite" });
    if (lbl) el.appendChild(lbl); else input.setAttribute("aria-label", o.ariaLabel || o.placeholder || "Text");
    if (bool(o.required, false)) input.setAttribute("aria-required", "true");
    el.appendChild(input); el.appendChild(msg);
    msg.textContent = o.help || "";
    input.value = initial;
    var committed = String(initial), touched = false, ext = "", api, re = null;
    if (o.pattern) { try { re = new RegExp("^(?:" + o.pattern + ")$"); } catch (e) { report("textfield: bad data-pattern", e, "textfield"); } }
    function check(v) {
      if (ext) return ext;
      if (bool(o.required, false) && !v) return o.requiredMessage || "Required";
      if (o.minlength && v.length < numOr(o.minlength, 0)) return "At least " + numOr(o.minlength, 0) + " characters";
      if (re && v && !re.test(v)) return o.patternMessage || "Invalid format";
      if (api && typeof api.validator === "function") { var r = api.validator(v); if (r) return String(r); }
      return null;
    }
    function show(err) {
      markError(w, !!err, err || "");
      if (err) input.setAttribute("aria-invalid", "true"); else input.removeAttribute("aria-invalid");
      msg.textContent = err || o.help || "";
      msg.setAttribute("role", err ? "alert" : "status");
      cls(msg, "is-error", !!err);
    }
    function validate(force) {
      var v = input.value, err = check(v);
      if (err && (touched || force || v !== "")) show(err); else show(null);
      return !err;
    }
    function commit() {
      touched = true;
      if (!validate(true)) return false;
      if (input.value !== committed) { committed = input.value; w.change({ value: committed }); }
      return true;
    }
    w.on(input, "input", function () { if (ext) ext = ""; fire(el, "apc:input", { id: w.id, value: input.value }); validate(false); });
    w.on(input, "keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); if (commit()) fire(el, "apc:submit", { id: w.id, value: committed }); else input.focus(); }
      else if (e.key === "Escape") { if (input.value !== committed) { e.preventDefault(); input.value = committed; touched = false; ext = ""; validate(false); } }
      e.stopPropagation();
    });
    w.on(input, "blur", function () {
      if (input.value === committed && !bool(o.required, false)) return;
      touched = true;
      if (validate(true) && input.value !== committed) commit();
    });
    w.applyDisabled = function (d) { input.disabled = d; };
    api = {
      validator: null,
      getValue: function () { return input.value; },
      setValue: function (v) { input.value = String(v); committed = input.value; touched = false; ext = ""; validate(false); },
      setError: function (m) { ext = m ? String(m) : ""; show(ext || null); },
      validate: function () { return validate(true); },
      primary: input,
      focus: function () { input.focus(); }
    };
    if (initialError) api.setError(initialError);
    return finish(w, api);
  }

  /* ================================================================================================
     numberfield : typed numeric with units and step buttons (parsing/format = the knob's value entry)
     ================================================================================================ */
  function initNumberfield(el, o) {
    var w = base(el, "numberfield", o), C = APC.controls;
    var model = null, b = null, value = 0, hintTimer = 0, hold = 0, rep = 0, repeated = false, api;
    APC.dom.clear(el);
    var input = h("input", { class: "apc-input apc-nf__input", type: "text", role: "spinbutton", id: w.id + "-in", autocomplete: "off", autocapitalize: "off", spellcheck: "false",
      inputmode: "decimal", "aria-describedby": w.id + "-msg" });
    var lbl = o.label ? h("label", { class: "apc-w__label", id: w.id + "-lbl", "for": input.id, text: o.label }) : null;
    var steppers = bool(o.steppers, true);
    var minus = steppers ? h("button", { class: "apc-nf__btn", type: "button", tabindex: "-1", "aria-label": "Decrease" + (o.label ? " " + o.label : ""), text: "−" }) : null;
    var plus = steppers ? h("button", { class: "apc-nf__btn", type: "button", tabindex: "-1", "aria-label": "Increase" + (o.label ? " " + o.label : ""), text: "+" }) : null;
    var group = h("div", { class: "apc-nf", role: "group" }, minus, input, plus);
    var msg = h("div", { class: "apc-w__msg", id: w.id + "-msg", "aria-live": "polite" });
    if (lbl) el.appendChild(lbl); else input.setAttribute("aria-label", o.ariaLabel || "Value");
    el.appendChild(group); el.appendChild(msg);
    msg.textContent = o.help || "";

    function fmt(v) { return model ? model.format(v) : ""; }
    function paint() {
      if (!model) return;
      input.value = fmt(value);
      input.setAttribute("aria-valuemin", String(model.min)); input.setAttribute("aria-valuemax", String(model.max));
      input.setAttribute("aria-valuenow", String(value)); input.setAttribute("aria-valuetext", fmt(value));
      if (minus) minus.disabled = w.disabled || value <= model.min;
      if (plus) plus.disabled = w.disabled || value >= model.max;
    }
    function say(text, isErr) {
      msg.textContent = text || o.help || "";
      cls(msg, "is-error", !!isErr);
      msg.setAttribute("role", isErr ? "alert" : "status");
      markError(w, !!isErr, isErr ? text : "");
      if (isErr) input.setAttribute("aria-invalid", "true"); else input.removeAttribute("aria-invalid");
      w.cancel(hintTimer); hintTimer = 0;
      if (text) hintTimer = w.later(function () { hintTimer = 0; say("", false); }, 2200);
    }
    function apply(v, label) {
      if (!model) return false;
      var before = value, changed;
      if (b) {
        if (b.active) { b.set(v); changed = true; } else changed = b.commit(v, label);
        value = b.value;
      } else { v = model.snap(v); changed = v !== value; value = v; }
      paint();
      if (value !== before) w.change({ value: value, text: fmt(value) });
      return changed;
    }
    function amount(kind) {
      var r = model.range();
      if (model.step) return model.step * (kind === "coarse" ? 10 : 1);
      return r * (kind === "coarse" ? 0.1 : (kind === "fine" ? 0.001 : 0.01));
    }
    function nameOf() { return b ? b.name() : (o.label || "value"); }
    function stepBy(d, kind) { if (!model || w.disabled) return; apply(value + d * amount(kind), "Set " + nameOf()); }
    function commitText(fromBlur) {
      if (!model) return;
      var r = model.parse(input.value);
      if (!r.ok) {
        say(r.reason, true);
        if (fromBlur) paint(); else input.focus();
        return;
      }
      apply(r.value, "Set " + nameOf());
      paint();
      say(r.clamped ? "Clamped to " + model.rangeText() : "", false);
    }
    function setup(m, v) { model = m; value = v; el.removeAttribute("aria-busy"); input.disabled = w.disabled; paint(); }
    if (!C || !C.Model) {
      report("APC numberfield needs apc-controls.js (shared value parsing)", "", "numberfield");
      markError(w, true, "needs apc-controls.js"); input.disabled = true;
    } else if (o.param) {
      el.setAttribute("aria-busy", "true"); input.disabled = true;
      b = bindParam(w, o.param, function (kind) {
        if (kind === "error") { markError(w, true, "Parameter unavailable"); el.removeAttribute("aria-busy"); return; }
        if (kind === "ready") {
          markError(w, false);
          if (!model || document.activeElement !== input) setup(b.model, b.value);
          else { model = b.model; value = b.value; }
        } else { value = b.value; paint(); }
      });
    } else {
      var mn = numOr(o.min, 0), mx = numOr(o.max, 100), def = numOr(o["default"], mn);
      var m = new C.Model({ min: mn, max: mx, step: numOr(o.step, 0), unit: o.unit || "", "default": def, value: numOr(o.value, def), digits: o.digits !== undefined ? numOr(o.digits, undefined) : undefined });
      setup(m, m.snap(numOr(o.value, def)));
    }
    w.on(input, "focus", function () { try { input.select(); } catch (e) {} });
    w.on(input, "keydown", function (e) {
      var k = e.key;
      e.stopPropagation();
      if (k === "Enter") { e.preventDefault(); commitText(false); }
      else if (k === "Escape") { e.preventDefault(); paint(); say("", false); }
      else if (k === "ArrowUp") { e.preventDefault(); stepBy(1, e.shiftKey ? "fine" : "step"); }
      else if (k === "ArrowDown") { e.preventDefault(); stepBy(-1, e.shiftKey ? "fine" : "step"); }
      else if (k === "PageUp") { e.preventDefault(); stepBy(1, "coarse"); }
      else if (k === "PageDown") { e.preventDefault(); stepBy(-1, "coarse"); }
    });
    w.on(input, "input", function () { if (msg.classList.contains("is-error")) say("", false); });
    w.on(input, "blur", function () { if (model && input.value !== fmt(value)) commitText(true); });
    w.on(input, "wheel", function (e) {
      if (document.activeElement !== input || !model || w.disabled) return;
      e.preventDefault();
      stepBy(e.deltaY < 0 ? 1 : -1, e.shiftKey ? "fine" : "step");
    }, { passive: false });
    function holdStop() { w.cancel(hold); w.cancel(rep); hold = 0; rep = 0; if (b && b.active) b.end(); }
    function holdStart(d) {
      holdStop(); repeated = false;
      hold = w.later(function () {
        hold = 0; repeated = true;
        if (b) b.begin("Adjust " + b.name());
        rep = w.every(function () { stepBy(d, "step"); }, 70);
      }, 400);
    }
    function wireBtn(btn, d) {
      if (!btn) return;
      w.on(btn, "pointerdown", function (e) { if (e.button !== undefined && e.button !== 0) return; holdStart(d); });
      w.on(btn, "pointerup", holdStop); w.on(btn, "pointercancel", holdStop); w.on(btn, "pointerleave", holdStop);
      w.on(btn, "click", function () { if (repeated) { repeated = false; return; } stepBy(d, "step"); });
    }
    wireBtn(minus, -1); wireBtn(plus, 1);
    w.applyDisabled = function (d) { input.disabled = d || !model; paint(); if (model) { if (minus) minus.disabled = d || value <= model.min; if (plus) plus.disabled = d || value >= model.max; } };
    w.onDispose(holdStop);
    api = {
      getValue: function () { return value; },
      setValue: function (v) { if (model) { value = model.snap(v); if (b) b.value = value; paint(); } },
      getText: function () { return fmt(value); },
      primary: input,
      focus: function () { input.focus(); }
    };
    return finish(w, api);
  }

  /* ================================================================================================
     label : static text roles
     ================================================================================================ */
  function initLabel(el, o) {
    var w = base(el, "label", o);
    var role = /^(title|label|caption|value)$/.test(o.role || "") ? o.role : "label";
    el.classList.add("apc-text", "apc-text--" + role);
    el.setAttribute("data-role", role);
    if (o.text !== undefined) el.textContent = o.text;
    if (role === "title" && !el.hasAttribute("role")) { el.setAttribute("role", "heading"); el.setAttribute("aria-level", o.level || "2"); }
    var target = null, prevLabelledBy = null, reported = false;
    function undo() {
      if (!target) return;
      if (prevLabelledBy === null) target.removeAttribute("aria-labelledby"); else target.setAttribute("aria-labelledby", prevLabelledBy);
      target = null;
    }
    /* the named widget may mount after this label: resolve now and again right after the current mount pass */
    function resolve() {
      if (w.disposed || !o["for"]) return;
      var sel = /^[A-Za-z][\w-]*$/.test(o["for"]) ? "#" + o["for"] : o["for"], host = null, t;
      try { host = document.querySelector(sel); } catch (e) { host = null; }
      if (!host) { if (!reported) { reported = true; report("label: data-for target not found: " + o["for"], "", "label"); } return; }
      t = (host.__apcW && host.__apcW.primary) || (host.getAttribute("role") ? host : (host.querySelector("input,[role],button,select,textarea") || host));
      if (t === target) return;
      undo();
      target = t; prevLabelledBy = t.getAttribute("aria-labelledby");
      t.setAttribute("aria-labelledby", w.id);
    }
    resolve();
    Promise.resolve().then(resolve);
    w.onDispose(undo);
    return finish(w, {
      setText: function (t) { el.textContent = t; },
      getText: function () { return el.textContent; }
    });
  }

  /* ================================================================================================
     readout : live read-only value (param, meter or manual)
     ================================================================================================ */
  function initReadout(el, o) {
    var w = base(el, "readout", o), b = null;
    APC.dom.clear(el);
    var layout = /^inline$/i.test(o.layout || "") ? "inline" : "stack";
    el.setAttribute("data-layout", layout);
    el.setAttribute("data-align", /^(start|end|center)$/.test(o.align || "") ? o.align : "start");
    var lbl = o.label ? h("span", { class: "apc-w__label", id: w.id + "-lbl", text: o.label }) : null;
    var out = h("output", { class: "apc-rd__value", id: w.id + "-out", "aria-live": "off", text: o.text !== undefined ? o.text : "—" });
    if (lbl) { el.appendChild(lbl); out.setAttribute("aria-labelledby", lbl.id + " " + out.id); }
    else if (o.ariaLabel) out.setAttribute("aria-label", o.ariaLabel);
    el.appendChild(out);
    function show(txt) { out.textContent = txt; }
    function fromNumber(v) {
      if (typeof v !== "number") return String(v);
      return APC.format.value(v, o.unit || "", o.digits !== undefined ? numOr(o.digits, undefined) : undefined);
    }
    if (o.param) {
      el.setAttribute("aria-busy", "true");
      b = bindParam(w, o.param, function (kind) {
        if (kind === "error") { markError(w, true, "Parameter unavailable"); el.removeAttribute("aria-busy"); show("—"); return; }
        if (kind === "ready") { markError(w, false); el.removeAttribute("aria-busy"); }
        show(b.model.format(b.value));
      });
    } else if (o.meter) {
      w.onDispose(onMeter(o.meter, function (v) { show(fromNumber(v)); }));
    }
    return finish(w, {
      setValue: function (v) { show(fromNumber(v)); },
      getText: function () { return out.textContent; }
    });
  }

  /* ================================================================================================
     panel : titled group box with optional collapse
     ================================================================================================ */
  function initPanel(el, o) {
    var w = base(el, "panel", o);
    var title = o.title !== undefined ? o.title : (o.label || "");
    var collapsible = bool(o.collapsible, false), collapsed = collapsible && bool(o.collapsed, false);
    var kids = [], c = el.firstChild, body, head, toggle = null, titleNode;
    while (c) { kids.push(c); c = c.nextSibling; }
    body = h("div", { class: "apc-panel__body", id: w.id + "-body" });
    kids.forEach(function (k) { body.appendChild(k); });
    titleNode = h("span", { class: "apc-panel__title", id: w.id + "-title", text: title });
    if (collapsible) {
      toggle = h("button", { type: "button", class: "apc-panel__toggle", "aria-expanded": "true", "aria-controls": body.id }, h("span", { class: "apc-panel__chev", "aria-hidden": "true" }, chevron("apc-chev")), titleNode);
      head = h("div", { class: "apc-panel__head" }, toggle);
    } else head = h("div", { class: "apc-panel__head" }, titleNode);
    if (!title) head.hidden = true;
    el.setAttribute("role", "group");
    if (title) el.setAttribute("aria-labelledby", titleNode.id); else if (o.ariaLabel) el.setAttribute("aria-label", o.ariaLabel);
    el.appendChild(head); el.appendChild(body);
    function paint() {
      body.hidden = collapsed; cls(el, "is-collapsed", collapsed);
      if (toggle) toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
    }
    function set(v) {
      v = !!v;
      if (v === collapsed || (!collapsible && v)) return;
      collapsed = v; paint();
      fire(el, "apc:toggle", { id: w.id, collapsed: collapsed });
      w.change({ collapsed: collapsed });
    }
    if (toggle) w.on(toggle, "click", function () { if (!w.disabled) set(!collapsed); });
    w.applyDisabled = function (d) { if (toggle) toggle.disabled = d; };
    paint();
    return finish(w, {
      isCollapsed: function () { return collapsed; },
      setCollapsed: function (v) { set(v); },
      toggle: function () { set(!collapsed); },
      body: body
    });
  }

  /* ================================================================================================
     divider
     ================================================================================================ */
  function initDivider(el, o) {
    var w = base(el, "divider", o), orient = dir(o);
    var text = o.label !== undefined ? o.label : textOf(el);
    APC.dom.clear(el);
    el.setAttribute("role", "separator"); el.setAttribute("aria-orientation", orient); el.setAttribute("data-orient", orient);
    if (text && orient === "horizontal") {
      el.appendChild(h("span", { class: "apc-divider__line", "aria-hidden": "true" }));
      el.appendChild(h("span", { class: "apc-divider__text", text: text }));
      el.appendChild(h("span", { class: "apc-divider__line", "aria-hidden": "true" }));
      el.setAttribute("aria-label", text);
    } else el.appendChild(h("span", { class: "apc-divider__line", "aria-hidden": "true" }));
    return finish(w, {});
  }

  /* ================================================================================================
     led : indicator (on/off/ok/warn/error), optionally param-bound
     ================================================================================================ */
  function initLed(el, o) {
    var w = base(el, "led", o), b = null, state = "off";
    var states = o.states ? o.states.split(",").map(function (s) { return s.trim(); }) : null;
    var text = o.label !== undefined ? o.label : textOf(el);
    APC.dom.clear(el);
    var dot = h("span", { class: "apc-led", "aria-hidden": "true" });
    var lab = text ? h("span", { class: "apc-led__label", text: text }) : null;
    el.appendChild(dot); if (lab) el.appendChild(lab);
    el.setAttribute("role", "img");
    function paint() {
      dot.setAttribute("data-state", state);
      el.setAttribute("data-state", state);
      el.setAttribute("aria-label", (text ? text + ": " : "") + state);
    }
    function setState(s) {
      s = /^(on|off|ok|warn|error)$/.test(s) ? s : (s && s !== "false" ? "on" : "off");
      state = s; paint();
    }
    if (o.param) {
      el.setAttribute("aria-busy", "true");
      b = bindParam(w, o.param, function (kind) {
        if (kind === "error") { markError(w, true, "Parameter unavailable"); el.removeAttribute("aria-busy"); setState("error"); return; }
        if (kind === "ready") { markError(w, false); el.removeAttribute("aria-busy"); }
        if (states) setState(states[clamp(Math.round(b.value - b.model.min), 0, states.length - 1)]);
        else setState(b.value > b.model.min ? "on" : "off");
      });
    } else setState(o.state !== undefined ? o.state : (bool(o.on, false) ? "on" : "off"));
    paint();
    return finish(w, { setState: setState, getState: function () { return state; }, setOn: function (v) { setState(v ? "on" : "off"); } });
  }

  /* ================================================================================================
     progress : determinate / indeterminate bar
     ================================================================================================ */
  function initProgress(el, o) {
    var w = base(el, "progress", o), orient = dir(o), b = null;
    var min = numOr(o.min, 0), max = numOr(o.max, 1), value = numOr(o.value, 0), indet = bool(o.indeterminate, false);
    APC.dom.clear(el);
    el.setAttribute("data-orient", orient);
    var lbl = o.label ? h("span", { class: "apc-w__label", id: w.id + "-lbl", text: o.label }) : null;
    var txt = bool(o.showValue, false) ? h("span", { class: "apc-progress__text", "aria-hidden": "true" }) : null;
    var fill = h("span", { class: "apc-progress__fill" });
    var track = h("div", { class: "apc-progress__track", role: "progressbar", id: w.id + "-bar" }, fill);
    if (lbl) track.setAttribute("aria-labelledby", lbl.id); else track.setAttribute("aria-label", o.ariaLabel || "Progress");
    var head = (lbl || txt) ? h("div", { class: "apc-progress__head" }, lbl, txt) : null;
    if (head) el.appendChild(head);
    el.appendChild(track);
    if (o.state) el.setAttribute("data-state", o.state);
    function paint() {
      var t = max > min ? clamp((value - min) / (max - min), 0, 1) : 0, pct = Math.round(t * 100);
      cls(el, "is-indeterminate", indet);
      if (indet) {
        track.removeAttribute("aria-valuenow"); track.removeAttribute("aria-valuetext");
        fill.style.width = ""; fill.style.height = "";
        if (txt) txt.textContent = "";
      } else {
        track.setAttribute("aria-valuemin", String(min)); track.setAttribute("aria-valuemax", String(max));
        track.setAttribute("aria-valuenow", String(value)); track.setAttribute("aria-valuetext", pct + "%");
        if (orient === "vertical") { fill.style.height = pct + "%"; fill.style.width = ""; } else { fill.style.width = pct + "%"; fill.style.height = ""; }
        if (txt) txt.textContent = pct + "%";
      }
    }
    if (o.param) {
      el.setAttribute("aria-busy", "true");
      b = bindParam(w, o.param, function (kind) {
        if (kind === "error") { markError(w, true, "Parameter unavailable"); el.removeAttribute("aria-busy"); return; }
        if (kind === "ready") { markError(w, false); el.removeAttribute("aria-busy"); min = b.model.min; max = b.model.max; }
        value = b.value; indet = false; paint();
      });
    } else if (o.meter) {
      w.onDispose(onMeter(o.meter, function (v) { if (typeof v === "number") { value = v; indet = false; paint(); } }));
    }
    paint();
    return finish(w, {
      setValue: function (v) { value = v; indet = false; paint(); },
      getValue: function () { return value; },
      setIndeterminate: function (v) { indet = !!v; paint(); },
      setState: function (s) { if (s) el.setAttribute("data-state", s); else el.removeAttribute("data-state"); }
    });
  }

  /* ================================================================================================
     logo : wordmark / lockup slot (text, inline SVG, <img>); link only when a URL is configured
     ================================================================================================ */
  function initLogo(el, o) {
    var w = base(el, "logo", o), url = o.url || "", linkKey = o.link || "", btn = null, inner;
    var kids = [], c = el.firstChild;
    while (c) { kids.push(c); c = c.nextSibling; }
    var alt = o.alt || o.text || o.label || "";
    inner = h("span", { class: "apc-logo__mark" });
    if (o.src) inner.appendChild(h("img", { class: "apc-logo__img", src: o.src, alt: alt }));
    else if (kids.some(function (k) { return k.nodeType === 1; })) kids.forEach(function (k) { inner.appendChild(k); });
    else if (o.text !== undefined || textOf(el)) inner.appendChild(h("span", { class: "apc-logo__text", text: o.text !== undefined ? o.text : textOf(el) }));
    APC.dom.clear(el);
    if (!alt) alt = textOf(inner) || "";
    var sub = o.sub ? h("span", { class: "apc-logo__sub", text: o.sub }) : null;
    var hasText = !!inner.querySelector(".apc-logo__text");
    if (!hasText) { inner.setAttribute("role", "img"); if (alt) inner.setAttribute("aria-label", alt); }
    function render(href) {
      APC.dom.clear(el);
      btn = null;
      if (href) {
        btn = h("button", { type: "button", class: "apc-logo__link", "aria-label": "Open " + (alt || "website") + " website", title: "Open " + (alt || "website") + " website" }, inner, sub);
        w.on(btn, "click", function () { if (!w.disabled) call("apc.openUrl", { url: href }); });
        el.appendChild(btn);
      } else { el.appendChild(inner); if (sub) el.appendChild(sub); }
      cls(el, "has-link", !!href);
    }
    render(url);
    if (!url && linkKey) {
      call("apc.info", {}).then(function (info) {
        if (w.disposed) return;
        var l = info && info.links && info.links[linkKey];
        if (l) render(l);
      });
    }
    w.applyDisabled = function (d) { if (btn) btn.disabled = d; };
    return finish(w, { hasLink: function () { return !!btn; } });
  }

  /* ================================================================================================
     registration + public helpers
     ================================================================================================ */
  APC.register("button", initButton);
  APC.register("buttons", function (el, o) { return initGroup(el, o, "buttons"); });
  APC.register("segmented", function (el, o) { return initGroup(el, o, "buttons"); });
  APC.register("checkbox", initCheckbox);
  APC.register("radio", function (el, o) { return initGroup(el, o, "radio"); });
  APC.register("dropdown", initDropdown);
  APC.register("menu", initMenu);
  APC.register("tabs", initTabs);
  APC.register("textfield", initTextfield);
  APC.register("numberfield", initNumberfield);
  APC.register("label", initLabel);
  APC.register("readout", initReadout);
  APC.register("panel", initPanel);
  APC.register("divider", initDivider);
  APC.register("led", initLed);
  APC.register("progress", initProgress);
  APC.register("list", initList);
  APC.register("logo", initLogo);

  APC.widgets = {
    get: function (el) { return (el && el.__apcW) || null; },
    stats: function () { return { listeners: live.listeners, timers: live.timers, binds: live.binds, popups: live.popups, widgets: live.widgets }; },
    closeAll: closeAllPopups,
    popup: popup,
    /* open a menu programmatically: APC.widgets.openMenu([{id,label,...}], { x, y | anchor, label, id, onselect(item) }) -> { close() } */
    openMenu: function (items, opts) {
      opts = opts || {};
      var userSel = opts.onselect, mid = opts.id || "menu";
      return openMenuPopup(normMenuItems(items), { anchor: opts.anchor || null, x: opts.x, y: opts.y, label: opts.label, focus: opts.focus || "first",
        onClose: opts.onClose, onselect: function (it) {
          var item = { id: it.id, label: it.label, checked: it.checked, shortcut: it.shortcut };
          if (typeof userSel === "function") userSel(item);
          APC.emit("menu", { id: mid, item: item });
        } });
    }
  };
})();
