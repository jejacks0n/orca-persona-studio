// The Persona Studio tab's stylesheet, in Orca's theme variables. The root has class `app`; its children (src/app-view.ts's
// header, list, detail and notice bar) are placed by grid area, so their order in it doesn't matter. The glue adds
// `v-list` or `v-detail` to the root, and below 700 px `narrow` too: then only that pane shows.
export const STYLES = `
  :root { --ps-bug: #c81e1e; --ps-missing: #1d4ed8; --ps-polish: #a15c07; --ps-ok: #15803d; }
  html.dark { --ps-bug: #f87171; --ps-missing: #7aa7ff; --ps-polish: #f0b045; --ps-ok: #4ade80; }
  /* ponytail: Orca's chats sit on --chat-canvas (5% foreground into the background in dark, the background in light), which frames
     aren't given; this copies its recipe from the tokens they are given. If Orca ever passes the canvas through, use that. */
  :root { --ps-canvas: var(--orca-background); } html.dark { --ps-canvas: color-mix(in srgb, var(--orca-foreground) 5%, var(--orca-background)); }
  * { box-sizing: border-box; }
  body { margin: 0; font: 13px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; color: var(--orca-foreground); background: var(--ps-canvas); }
  button, input, textarea { font: inherit; color: inherit; }
  a { color: var(--orca-primary); }
  svg.i { width: 15px; height: 15px; flex: none; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
  :focus-visible { outline: 2px solid var(--orca-ring); outline-offset: 1px; }
  .dim { color: var(--orca-muted-foreground); }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
  .ok { color: var(--ps-ok); }
  .k-bug { color: var(--ps-bug); } .k-missing { color: var(--ps-missing); } .k-polish { color: var(--ps-polish); }

  .btn { display: inline-flex; align-items: center; gap: 6px; min-height: 30px; padding: 4px 11px; border: 1px solid var(--orca-border); border-radius: calc(var(--orca-radius) - 2px);
    background: var(--orca-secondary); color: var(--orca-secondary-foreground); cursor: pointer; white-space: nowrap; transition: background .12s, border-color .12s; }
  .btn:hover { background: var(--orca-accent); color: var(--orca-accent-foreground); }
  .btn.primary { background: var(--orca-primary); color: var(--orca-primary-foreground); border-color: transparent; font-weight: 600; }
  .btn.primary:hover { opacity: .88; }
  .btn.ghost { border-color: transparent; background: transparent; color: inherit; }
  .btn.ghost:hover { background: var(--orca-accent); }
  .btn.small { min-height: 26px; padding: 2px 8px; font-size: 12px; }
  .btn.danger { color: var(--orca-destructive); }
  .linkish { padding: 0; border: 0; background: none; color: var(--orca-primary); text-decoration: underline; cursor: pointer; text-align: left; }

  .app { display: grid; height: 100vh; min-height: 0;
    grid-template: "head head" auto "list detail" minmax(0, 1fr) "notice notice" auto / minmax(300px, 1fr) minmax(360px, 1.35fr); }
  .app.narrow { grid-template: "head" auto "main" minmax(0, 1fr) "notice" auto / minmax(0, 1fr); }
  .top { grid-area: head; } .list { grid-area: list; } .detail { grid-area: detail; } .notice { grid-area: notice; }
  .app.narrow .list, .app.narrow .detail { grid-area: main; }
  .app.narrow .list { border-right: 0; }
  .app.narrow.v-detail .list, .app.narrow.v-list .detail { display: none; }
  .message { grid-column: 1 / -1; grid-row: 1 / -1; place-self: center; max-width: 480px; padding: 24px; text-align: center; color: var(--orca-muted-foreground); }

  .top { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 10px; padding: 8px 12px; border-bottom: 1px solid var(--orca-border); background: var(--orca-card); color: var(--orca-card-foreground); }
  .brand { display: flex; align-items: center; gap: 8px; font-weight: 650; margin-right: auto; min-width: 0; flex: 1 1 auto; }
  .brand svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; flex: none; }
  .search { display: flex; align-items: center; gap: 6px; flex: 1 1 140px; max-width: 240px; min-width: 0; padding: 0 9px; min-height: 30px;
    border: 1px solid var(--orca-input); border-radius: calc(var(--orca-radius) - 2px); background: var(--orca-background); }
  .search input { flex: 1; width: 100%; min-width: 0; border: 0; outline: 0; background: transparent; }
  .search input::-webkit-search-cancel-button { display: none; }
  .search .clear { border: 0; background: none; padding: 0 2px; color: var(--orca-muted-foreground); font-size: 16px; line-height: 1; cursor: pointer; }
  .search .clear:hover { color: var(--orca-foreground); }
  .search:focus-within { outline: 2px solid var(--orca-ring); outline-offset: 1px; }
  .seg { display: inline-flex; flex: none; border: 1px solid var(--orca-border); border-radius: calc(var(--orca-radius) - 2px); overflow: hidden; }
  .seg button { border: 0; background: var(--orca-card); padding: 4px 10px; min-height: 28px; cursor: pointer; color: var(--orca-muted-foreground); }
  .seg button + button { border-left: 1px solid var(--orca-border); }
  .seg button[aria-pressed=true] { background: var(--orca-muted); color: var(--orca-foreground); font-weight: 600; }
  .app.narrow .search { max-width: none; }
  .app.narrow .seg button { padding: 4px 8px; }

  /* The Personas button; with a persona chosen, its name joined to a clear button. */
  .pick { display: inline-flex; flex: none; min-width: 0; }
  .pick .btn { max-width: 200px; }
  .pick .chev { width: 13px; height: 13px; color: var(--orca-muted-foreground); }
  .pick .avatar { width: 20px; height: 20px; font-size: 10.5px; grid-row: auto; align-self: center; background: var(--orca-background); flex: none; }
  .pick .name { overflow: hidden; text-overflow: ellipsis; font-weight: 600; }
  .pick.on .btn:first-child { border-top-right-radius: 0; border-bottom-right-radius: 0; background: var(--orca-muted); }
  .pick.on .btn + .btn { border-left: 0; border-top-left-radius: 0; border-bottom-left-radius: 0; padding: 4px 7px; color: var(--orca-muted-foreground); }
  .pick.on .btn + .btn:hover { color: var(--orca-accent-foreground); }
  [popovertarget="personas"] { anchor-name: --personas; }
  /* Under the Personas button, left edges aligned; else right edges aligned; else 12px in from the window's right. */
  @position-try --personas-edge { left: auto; right: 12px; }
  .pop { position: fixed; position-anchor: --personas; inset: auto; top: anchor(bottom); left: anchor(left); position-try-fallbacks: flip-inline, --personas-edge;
    margin: 4px 0 0; width: min(320px, calc(100vw - 24px)); max-height: min(440px, calc(100vh - 60px)); overflow: auto; padding: 0;
    border: 1px solid var(--orca-border); border-radius: var(--orca-radius); background: var(--orca-card); color: var(--orca-card-foreground); box-shadow: 0 14px 40px rgb(0 0 0 / .3); }
  .pop .empty { padding: 20px 16px; } .pop .empty p { margin: 0 0 12px; }
  .colhead { padding: 9px 12px 7px; font-size: 11px; letter-spacing: .05em; text-transform: uppercase; color: var(--orca-muted-foreground); font-weight: 600; }
  .persona { display: grid; grid-template-columns: 30px minmax(0, 1fr) auto; gap: 2px 9px; align-items: center; width: 100%; padding: 8px 10px 8px 12px; text-align: left;
    border: 0; border-top: 1px solid var(--orca-border); background: transparent; cursor: pointer; }
  .persona:hover { background: var(--orca-muted); }
  .persona[aria-pressed=true] { background: var(--orca-muted); box-shadow: inset 3px 0 0 var(--orca-primary); }
  .avatar { width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center; font-weight: 650; font-size: 12px; background: var(--orca-muted); border: 1px solid var(--orca-border); grid-row: span 2; align-self: start; }
  img.avatar { border: 0; object-fit: cover; }
  .portrait { width: 64px; height: 64px; border-radius: 50%; flex: none; }
  .persona .name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .persona .what { grid-column: 2 / 4; font-size: 12px; color: var(--orca-muted-foreground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .persona .what.live { color: var(--orca-foreground); } .persona .what.live .dot { display: inline-block; width: 7px; height: 7px; margin-right: 6px; vertical-align: 1px; }
  .badge { padding: 0 7px; border-radius: 999px; background: var(--orca-primary); color: var(--orca-primary-foreground); font-size: 11px; font-weight: 650; white-space: nowrap; }

  .list, .detail { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
  .list { border-right: 1px solid var(--orca-border); background: var(--orca-card); color: var(--orca-card-foreground); }
  .scroll { overflow: auto; flex: 1; min-height: 0; }
  .tabs { display: flex; gap: 2px; padding: 0 8px; border-bottom: 1px solid var(--orca-border); overflow-x: auto; flex: none; }
  .tabs button { border: 0; border-bottom: 2px solid transparent; background: transparent; padding: 9px 8px 7px; cursor: pointer; color: var(--orca-muted-foreground); white-space: nowrap; }
  .tabs button[aria-selected=true] { color: var(--orca-foreground); border-bottom-color: var(--orca-primary); font-weight: 600; }
  .tabs b { font-weight: 400; margin-left: 4px; padding: 0 6px; border-radius: 999px; background: var(--orca-muted); font-size: 11px; }
  .bulk { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; padding: 6px 10px 6px 12px; background: var(--orca-primary); color: var(--orca-primary-foreground); flex: none; }
  .bulk > span { margin-right: auto; font-weight: 600; }
  .bulk .btn { background: transparent; color: inherit; border-color: color-mix(in srgb, currentColor 35%, transparent); }
  .row { position: relative; display: grid; grid-template-columns: 18px minmax(0, 1fr); user-select: none; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--orca-border); align-items: start; }
  .row:hover { background: var(--orca-muted); }
  .row:has(.open[aria-current=true]) { background: var(--orca-muted); box-shadow: inset 3px 0 0 var(--orca-primary); }
  .row.picked, .row.picked:hover { background: color-mix(in srgb, var(--orca-primary) 14%, transparent); }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  .row .k { margin-top: 1px; }
  .open { display: block; min-width: 0; padding: 0; border: 0; background: none; text-align: left; cursor: pointer; }
  /* The open button covers the whole row, so a click anywhere on it opens or selects it. */
  .open::after { content: ""; position: absolute; inset: 0; }
  .open:focus-visible { outline: 0; }
  .row:has(.open:focus-visible) { outline: 2px solid var(--orca-ring); outline-offset: -2px; }
  .open .title { font-weight: 550; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .meta { display: flex; flex-wrap: wrap; gap: 4px 8px; align-items: center; margin-top: 4px; font-size: 12px; color: var(--orca-muted-foreground); }
  .chip { display: inline-flex; align-items: center; gap: 4px; padding: 0 7px; border: 1px solid var(--orca-border); border-radius: 999px; font-size: 11px; white-space: nowrap; background: var(--orca-card); }
  .chip:not([class*=k-]) { color: var(--orca-card-foreground); }
  .chip.strong { background: var(--orca-foreground); color: var(--orca-background); border-color: transparent; font-weight: 600; }
  .chip svg.i { width: 11px; height: 11px; }
  .empty { padding: 44px 20px; text-align: center; color: var(--orca-muted-foreground); }
  .empty b { display: block; color: var(--orca-foreground); margin-bottom: 4px; font-size: 14px; }

  .backbar { display: none; padding: 6px 10px; border-bottom: 1px solid var(--orca-border); }
  .app.narrow .backbar, .backbar.always { display: flex; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--ps-ok); flex: none; }
  .stages { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; margin-top: 10px; }
  .stages span { text-align: center; padding: 3px 4px; font-size: 11.5px; border-radius: 999px; border: 1px solid var(--orca-border); color: var(--orca-muted-foreground); }
  .stages span.on { background: var(--orca-foreground); color: var(--orca-background); border-color: transparent; font-weight: 600; }
  .stages span.done { color: var(--orca-foreground); }
  .log { list-style: none; margin: 10px 0 0; padding: 8px 10px; border: 1px solid var(--orca-border); border-radius: var(--orca-radius); background: var(--orca-background); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: var(--orca-muted-foreground); min-height: 96px; }
  .log li:last-child { color: var(--orca-foreground); }
  .line .push { margin-left: auto; }
  .dbody { padding: 16px 18px 20px; }
  .dbody h2 { font-size: 17px; line-height: 1.3; margin: 8px 0 6px; font-weight: 650; overflow-wrap: anywhere; }
  .dbody h1 { font-size: 22px; line-height: 1.2; margin: 4px 0 2px; font-weight: 700; overflow-wrap: anywhere; } .dbody .sub { font-size: 13px; color: var(--orca-muted-foreground); }
  .titled { display: flex; align-items: center; gap: 12px; } .titled .named { flex: 1; min-width: 0; } .titled .sub { margin: 0; }
  .dbody h3 { font-size: 11px; letter-spacing: .05em; text-transform: uppercase; color: var(--orca-muted-foreground); margin: 18px 0 6px; font-weight: 600; }
  .dbody p { margin: 0; overflow-wrap: anywhere; } .dbody ol { margin: 0; padding-left: 20px; } .dbody li + li { margin-top: 2px; }
  .card { border: 1px solid var(--orca-border); border-radius: var(--orca-radius); padding: 10px 12px; background: var(--orca-background); margin-top: 12px; }
  .card.warn { border-color: var(--ps-polish); }
  .card.bad { border-color: var(--orca-destructive); } .card.bad b { color: var(--orca-destructive); } .card .why { margin: 4px 0 0; overflow-wrap: anywhere; }
  .line { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .line + .line { margin-top: 6px; }
  .line.goal { flex-wrap: nowrap; align-items: flex-start; } .line.goal > span:first-child { flex: 1; min-width: 0; }
  .card > svg[role=img] { display: block; max-width: 100%; height: auto; margin-top: 8px; }
  .callout { margin-top: 14px; padding: 8px 12px; border: 1px solid var(--orca-border); border-left: 3px solid var(--orca-destructive); border-radius: var(--orca-radius); background: var(--orca-muted); }
  .shots { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 8px; align-items: start; }
  .shots .shot { display: block; padding: 0; border: 1px solid var(--orca-border); border-radius: 6px; overflow: hidden; cursor: zoom-in; background: var(--orca-muted); }
  .shots img { display: block; width: 100%; height: auto; }
  .shot-wait { aspect-ratio: 16 / 10; border: 1px dashed var(--orca-border); border-radius: 6px; background: var(--orca-muted); }
  textarea, .field input { width: 100%; padding: 7px 9px; border: 1px solid var(--orca-input); border-radius: calc(var(--orca-radius) - 2px); background: var(--orca-background); color: var(--orca-foreground); }
  textarea { min-height: 76px; resize: vertical; display: block; }
  .saving { margin-left: 6px; text-transform: none; letter-spacing: 0; font-weight: 400; }
  .who p { margin: 0 0 8px; max-width: 68ch; }
  /* The zero state: one column on one left edge. Every list shares a 24px gutter (icon, step number, chevron) and a text column;
     hairlines separate the parts, so nothing is boxed and the Setup button leads. Spacing steps: 2, 4, 8, 12, 16, 24, 32, 48. */
  .zero { grid-column: 1 / -1; grid-row: 1 / 3; overflow: auto; min-height: 0; }
  .zbody { --gutter: 24px; --beside: 12px; max-width: 600px; margin: 0 auto; padding: 48px 24px; }
  .zero .faces { display: flex; padding-left: 16px; margin-bottom: 16px; }
  .zero .faces img { width: 64px; height: 64px; border-radius: 50%; margin-left: -16px; border: 3px solid var(--ps-canvas); background: var(--ps-canvas); }
  .zero h1 { font-size: 20px; line-height: 1.3; margin: 0 0 8px; font-weight: 600; letter-spacing: -0.01em; text-wrap: balance; }
  .zero .hero p { margin: 0; color: var(--orca-muted-foreground); max-width: 60ch; text-wrap: pretty; }
  .zero .part { margin-top: 32px; padding-top: 24px; border-top: 1px solid var(--orca-border); }
  .zero h2 { margin: 0 0 12px; font-size: 11px; letter-spacing: .05em; text-transform: uppercase; color: var(--orca-muted-foreground); font-weight: 600; }
  .zero .intro { margin: 0 0 16px; color: var(--orca-muted-foreground); max-width: 60ch; text-wrap: pretty; }
  .zero .rows { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; }
  .zero .rows li { display: grid; grid-template-columns: var(--gutter) minmax(0, 1fr); gap: var(--beside); align-items: start; }
  .zero .rows b { display: block; font-weight: 600; }
  .zero .rows span:not(.mark) { color: var(--orca-muted-foreground); }
  .zero .mark { width: var(--gutter); height: 20px; display: grid; place-items: center; color: var(--orca-primary); }
  .zero .mark.num { width: 20px; height: 20px; margin-left: 2px; border-radius: 50%; border: 1px solid var(--orca-border); background: var(--orca-muted);
    color: var(--orca-muted-foreground); font-size: 11px; font-weight: 600; font-variant-numeric: tabular-nums; }
  .zero .foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-top: 24px; }
  .zero .foot .dim { color: var(--orca-muted-foreground); font-size: 12px; }
  /* The text takes nearly all the spare room on a shared line, so the button only grows once it wraps onto a line of its own. */
  .zero .foot .dim { flex: 9999 1 auto; } .zero .foot .btn { flex: 1 0 auto; justify-content: center; }
  .zero summary { list-style: none; display: grid; grid-template-columns: var(--gutter) auto minmax(0, 1fr); gap: var(--beside); align-items: center; cursor: pointer; }
  .zero summary::-webkit-details-marker { display: none; }
  .zero summary .dim { justify-self: end; color: var(--orca-muted-foreground); font-size: 12px; }
  .zero summary .chev { color: var(--orca-muted-foreground); transition: transform .15s; } .zero details[open] summary .chev { transform: rotate(90deg); }
  .zero summary:focus-visible { outline: 2px solid var(--orca-ring); outline-offset: 4px; border-radius: 2px; }
  .zero .more { padding-top: 16px; color: var(--orca-muted-foreground); }
  .zero .more p { margin: 16px 0 0 calc(var(--gutter) + var(--beside)); }
  .zero code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; padding: 1px 4px; border-radius: 4px; background: var(--orca-muted); color: var(--orca-foreground); }
  @media (prefers-reduced-motion: reduce) { .zero summary .chev { transition: none; } }
  .hint { font-size: 12px; color: var(--orca-muted-foreground); margin-top: 4px; }
  .stats { margin-top: 18px; } .stats .label { font-size: 11px; letter-spacing: .05em; text-transform: uppercase; font-weight: 600; }
  .timeline { list-style: none; margin: 0; padding: 0; font-size: 12px; color: var(--orca-muted-foreground); }
  .timeline li { padding-left: 14px; position: relative; }
  .timeline li::before { content: ""; position: absolute; left: 2px; top: 7px; width: 5px; height: 5px; border-radius: 50%; background: currentColor; }
  .actions { display: flex; flex-wrap: wrap; gap: 6px; padding: 10px 18px; border-top: 1px solid var(--orca-border); flex: none; }
  .actions .push { margin-left: auto; }

  .notice { display: flex; align-items: center; gap: 10px; padding: 7px 12px; border-top: 1px solid var(--orca-border); background: var(--orca-muted); min-height: 38px; }
  .notice p { margin: 0 auto 0 0; }
  .notice:empty { display: none; }

  dialog { border: 1px solid var(--orca-border); border-radius: calc(var(--orca-radius) + 2px); padding: 0; background: var(--orca-card); color: var(--orca-card-foreground);
    width: min(460px, calc(100vw - 32px)); box-shadow: 0 16px 48px rgb(0 0 0 / .28); }
  dialog.wide { width: min(760px, calc(100vw - 32px)); }
  dialog:modal { overscroll-behavior: contain; }
  dialog::backdrop { background: rgb(0 0 0 / .45); }
  dialog form { padding: 16px 18px; }
  dialog h2 { margin: 0 0 4px; font-size: 15px; }
  dialog p { margin: 0; }
  dialog .big { display: block; width: 100%; height: auto; margin-top: 8px; border-radius: 6px; }
  .field { display: block; margin-top: 12px; }
  form:has([data-field=workHow][value=each]:checked) .one-only { display: none; }
  .brief.pr-auto, form:has([data-field=autoPr]:checked) .brief.pr-owner { display: none; }
  form:has([data-field=autoPr]:checked) .brief.pr-auto { display: block; }
  .field > span { display: block; font-size: 12px; color: var(--orca-muted-foreground); margin-bottom: 3px; }
  .radio, .check { display: flex; gap: 8px; align-items: flex-start; padding: 5px 0; cursor: pointer; }
  .radio input, .check input { margin-top: 2px; }
  .check { margin-top: 8px; }
  .brief { border: 1px solid var(--orca-border); border-radius: calc(var(--orca-radius) - 2px); background: var(--orca-background); padding: 8px 10px; font-size: 12px; white-space: pre-wrap; max-height: 150px; overflow: auto; }
  .brief.cmds { margin-top: 12px; } .brief.cmds + .brief.cmds { margin-top: 6px; }
  .dfoot { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }

  @media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
`
