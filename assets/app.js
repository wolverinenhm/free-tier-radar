/* ============================================================
   FreeTier Radar — application logic
   Vanilla ES modules, no dependencies, no build step.
   ============================================================ */

const DATA_URL = "data/providers.json";
const LS_THEME = "ftr:theme";
const LS_FAVS = "ftr:favs";

const ACCESS = {
  "always-free":   { label: "Always free",   order: 0 },
  "free-models":   { label: "Free models",   order: 1 },
  "trial-credits": { label: "Trial credits", order: 2 },
  "local":         { label: "Local",         order: 3 }
};

const FLAGS = {
  openai: { label: "OpenAI-compatible" },
  nocard: { label: "No credit card" },
  fav:    { label: "Saved" }
};

/* ---------- state ---------- */

const state = {
  all: [],
  meta: {},
  query: "",
  access: new Set(),
  flags: new Set(),
  sort: "relevance",
  view: "grid",
  favs: new Set(loadFavs())
};

/* ---------- dom ---------- */

const $ = (sel) => document.querySelector(sel);
const el = {
  grid: $("#grid"),
  tableWrap: $("#tableWrap"),
  tableBody: $("#tableBody"),
  empty: $("#emptyState"),
  emptyHint: $("#emptyHint"),
  loadError: $("#loadError"),
  resultCount: $("#resultCount"),
  resetBtn: $("#resetBtn"),
  search: $("#search"),
  clearSearch: $("#clearSearch"),
  accessChips: $("#accessChips"),
  flagChips: $("#flagChips"),
  sort: $("#sort"),
  heroStats: $("#heroStats"),
  heroDate: $("#heroDate"),
  buildStamp: $("#buildStamp"),
  panel: $("#panel"),
  panelBody: $("#panelBody"),
  panelTitle: $("#panelTitle"),
  panelVendor: $("#panelVendor"),
  panelBadge: $("#panelBadge"),
  scrim: $("#scrim"),
  panelClose: $("#panelClose"),
  themeBtn: $("#themeBtn"),
  exportBtn: $("#exportBtn"),
  tpl: $("#tpl-card")
};

/* ---------- utilities ---------- */

function loadFavs() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_FAVS) || "[]");
    return Array.isArray(raw) ? raw : [];
  } catch { return []; }
}

function saveFavs() {
  try { localStorage.setItem(LS_FAVS, JSON.stringify([...state.favs])); } catch { /* quota / private mode */ }
}

function esc(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

/** 1000 -> "1K", 8000 -> "8K", 250 -> "250" */
function compact(n) {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  if (n >= 1000 && n % 1000 === 0) return `${n / 1000}K`;
  return n.toLocaleString("en-US");
}

function full(n) {
  return typeof n === "number" ? n.toLocaleString("en-US") : "—";
}

function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

/* ---------- search index ---------- */

function buildIndex(providers) {
  return providers.map((p) => ({
    ref: p,
    name: p.name.toLowerCase(),
    id: p.id.toLowerCase(),
    blob: [
      p.name, p.vendor, p.id, p.summary, p.notes,
      ...(p.models || []),
      ...(p.tags || []),
      ACCESS[p.access]?.label || "",
      p.regions || ""
    ].join(" ").toLowerCase()
  }));
}

let INDEX = [];

function score(item, tokens) {
  if (!tokens.length) return 0;
  let total = 0;
  for (const t of tokens) {
    if (item.name.startsWith(t)) total += 60;
    else if (item.name.includes(t)) total += 34;
    else if (item.id.includes(t)) total += 22;
    else if (item.blob.includes(t)) total += 8;
    else return -1; // every token must hit somewhere
  }
  return total;
}

/* ---------- filtering ---------- */

function passes(p, { ignoreAccess = false, ignoreFlag = null } = {}) {
  if (!ignoreAccess && state.access.size && !state.access.has(p.access)) return false;

  if (state.flags.size) {
    for (const f of state.flags) {
      if (f === ignoreFlag) continue;
      if (f === "openai" && !p.openaiCompatible) return false;
      if (f === "nocard" && p.creditCard) return false;
      if (f === "fav" && !state.favs.has(p.id)) return false;
    }
  }
  return true;
}

function queryTokens() {
  return state.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

function currentResults() {
  const tokens = queryTokens();
  const scored = [];

  for (const item of INDEX) {
    const p = item.ref;
    if (!passes(p)) continue;
    const s = score(item, tokens);
    if (s < 0) continue;
    scored.push({ p, s });
  }

  const byName = (a, b) => a.p.name.localeCompare(b.p.name);
  const sorters = {
    name: byName,
    rpd: (a, b) => (b.p.limits?.rpd ?? -1) - (a.p.limits?.rpd ?? -1) || byName(a, b),
    rpm: (a, b) => (b.p.limits?.rpm ?? -1) - (a.p.limits?.rpm ?? -1) || byName(a, b),
    verified: (a, b) => String(b.p.verified || "").localeCompare(String(a.p.verified || "")) || byName(a, b),
    relevance: (a, b) => {
      if (b.s !== a.s) return b.s - a.s;
      const ao = ACCESS[a.p.access]?.order ?? 9;
      const bo = ACCESS[b.p.access]?.order ?? 9;
      if (ao !== bo) return ao - bo;
      return byName(a, b);
    }
  };

  scored.sort(sorters[state.sort] || sorters.relevance);
  return scored.map((x) => x.p);
}

/* ---------- chips ---------- */

function renderChips() {
  const accessCounts = {};
  for (const key of Object.keys(ACCESS)) {
    accessCounts[key] = INDEX.filter((i) => i.ref.access === key && passes(i.ref, { ignoreAccess: true })).length;
  }

  el.accessChips.innerHTML = Object.entries(ACCESS).map(([key, cfg]) => `
    <button class="chip" type="button" data-access="${key}"
            aria-pressed="${state.access.has(key)}">
      <span class="chip-dot" style="background:var(--${key === "always-free" ? "accent" : key === "free-models" ? "blue" : key === "trial-credits" ? "amber" : "grey"})"></span>
      ${cfg.label}<span class="chip-n">${accessCounts[key]}</span>
    </button>`).join("");

  const flagCounts = {
    openai: INDEX.filter((i) => i.ref.openaiCompatible && passes(i.ref, { ignoreFlag: "openai" })).length,
    nocard: INDEX.filter((i) => !i.ref.creditCard && passes(i.ref, { ignoreFlag: "nocard" })).length,
    fav: state.favs.size
  };

  el.flagChips.innerHTML = Object.entries(FLAGS).map(([key, cfg]) => `
    <button class="chip" type="button" data-flag="${key}"
            aria-pressed="${state.flags.has(key)}">
      ${cfg.label}<span class="chip-n">${flagCounts[key]}</span>
    </button>`).join("");
}

/* ---------- cards ---------- */

function metricChips(p) {
  const l = p.limits || {};
  const out = [];
  if (l.rpm != null) out.push(`<span class="metric"><b>${compact(l.rpm)}</b>RPM</span>`);
  if (l.rpd != null) out.push(`<span class="metric"><b>${compact(l.rpd)}</b>RPD</span>`);
  if (l.tpm != null) out.push(`<span class="metric"><b>${compact(l.tpm)}</b>TPM</span>`);
  if (l.tpd != null) out.push(`<span class="metric"><b>${compact(l.tpd)}</b>TPD</span>`);

  // Numeric chips are the scannable part; the prose note carries the caveats
  // (reset windows, credit thresholds) that numbers alone cannot express.
  if (l.text) out.push(`<span class="metric is-text" title="${esc(l.text)}">${esc(l.text)}</span>`);
  if (!out.length) out.push(`<span class="metric is-text">See provider docs</span>`);

  return out.slice(0, 3).join("");
}

function renderCards(list) {
  el.grid.innerHTML = "";
  const frag = document.createDocumentFragment();

  for (const p of list) {
    const node = el.tpl.content.firstElementChild.cloneNode(true);
    node.dataset.id = p.id;
    node.dataset.access = p.access;
    node.setAttribute("aria-label", `${p.name} — ${ACCESS[p.access]?.label}. Open details.`);

    node.querySelector(".card-name").textContent = p.name;
    node.querySelector(".card-vendor").textContent = p.vendor;

    const badge = node.querySelector(".badge");
    badge.dataset.access = p.access;
    badge.textContent = ACCESS[p.access]?.label || p.access;

    const fav = node.querySelector(".fav-btn");
    fav.setAttribute("aria-pressed", String(state.favs.has(p.id)));
    fav.dataset.fav = p.id;

    node.querySelector(".card-summary").textContent = p.summary;
    node.querySelector(".card-metrics").innerHTML = metricChips(p);

    node.querySelector(".card-models").innerHTML = (p.models || [])
      .slice(0, 3)
      .map((m) => `<span class="model-tag">${esc(m)}</span>`)
      .join("");

    node.querySelector(".card-verified").innerHTML =
      `<span class="conf-dot conf-${esc(p.confidence || "low")}"></span>verified ${esc(fmtDate(p.verified))}`;

    frag.appendChild(node);
  }

  el.grid.appendChild(frag);
}

/* ---------- table ---------- */

function renderTable(list) {
  el.tableBody.innerHTML = list.map((p) => `
    <tr data-id="${esc(p.id)}" tabindex="0">
      <td class="t-name">${esc(p.name)}</td>
      <td><span class="badge" data-access="${esc(p.access)}">${esc(ACCESS[p.access]?.label || p.access)}</span></td>
      <td class="num">${p.limits?.rpm != null ? compact(p.limits.rpm) : "—"}</td>
      <td class="num">${p.limits?.rpd != null ? compact(p.limits.rpd) : "—"}</td>
      <td class="t-limits">${esc(p.limits?.text || "—")}</td>
      <td class="center">${p.openaiCompatible ? '<span class="tick">✓</span>' : '<span class="cross">—</span>'}</td>
      <td class="center">${p.creditCard ? '<span class="cross">required</span>' : '<span class="tick">none</span>'}</td>
      <td class="t-limits">${esc(p.verified)}</td>
    </tr>`).join("");
}

/* ---------- render ---------- */

function render() {
  const list = currentResults();

  renderChips();

  const total = INDEX.length;
  const activeFilters = state.access.size + state.flags.size;
  el.resultCount.textContent = activeFilters || state.query
    ? `${list.length} of ${total} providers`
    : `${total} providers indexed`;
  el.resetBtn.hidden = !(activeFilters || state.query);

  const showGrid = state.view === "grid";
  el.grid.hidden = !showGrid;
  el.tableWrap.hidden = showGrid;

  if (showGrid) renderCards(list);
  else renderTable(list);

  const none = list.length === 0;
  el.empty.hidden = !none;
  if (none) {
    el.emptyHint.textContent = state.query
      ? `Nothing matches “${state.query}” with the current filters.`
      : "No providers match the selected filters.";
  }
}

function renderStats() {
  const total = state.all.length;
  const alwaysFree = state.all.filter((p) => p.access === "always-free").length;
  const noCard = state.all.filter((p) => !p.creditCard).length;
  const compatible = state.all.filter((p) => p.openaiCompatible).length;

  el.heroStats.innerHTML = [
    ["Providers", total],
    ["Always free", alwaysFree],
    ["No card needed", noCard],
    ["OpenAI-compatible", compatible]
  ].map(([label, n]) => `<div class="stat"><b>${n}</b>${label}</div>`).join("");

  const updated = state.meta.updated || "";
  el.heroDate.textContent = fmtDate(updated);
  el.buildStamp.textContent = `v${state.meta.version || "1.0"} · ${updated}`;
}

function setView(view) {
  state.view = view === "table" ? "table" : "grid";
  document.querySelectorAll("[data-view]").forEach((b) => {
    const on = b.dataset.view === state.view;
    b.classList.toggle("is-active", on);
    b.setAttribute("aria-pressed", String(on));
  });
  render();
}

/* ---------- detail panel ---------- */

const SNIPPET_MODEL = {
  ollama: "llama4",
  "lm-studio": "local-model",
  vllm: "Qwen/Qwen3-8B"
};

function snippetModel(p) {
  return SNIPPET_MODEL[p.id] || (p.models && p.models[0]) || "your-model";
}

function codeSamples(p) {
  const base = p.apiBase;
  const model = snippetModel(p);
  const key = p.access === "local" ? (p.id === "lm-studio" ? "lm-studio" : "ollama") : "YOUR_API_KEY";

  if (!p.openaiCompatible) {
    return {
      curl: `curl ${base}/chat \\
  -H "Authorization: Bearer ${key}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${model}",
    "messages": [{"role": "user", "content": "Hello"}]
  }'`,
      python: `import cohere

co = cohere.ClientV2(api_key="${key}")
res = co.chat(
    model="${model}",
    messages=[{"role": "user", "content": "Hello"}],
)
print(res.message.content[0].text)`,
      js: `const res = await fetch("${base}/chat", {
  method: "POST",
  headers: {
    Authorization: \`Bearer \${process.env.${key === "YOUR_API_KEY" ? "API_KEY" : "API_KEY"}}\`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model: "${model}",
    messages: [{ role: "user", content: "Hello" }],
  }),
});
console.log(await res.json());`
    };
  }

  return {
    curl: `curl ${base}/chat/completions \\
  -H "Authorization: Bearer ${key}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${model}",
    "messages": [{"role": "user", "content": "Hello"}]
  }'`,
    python: `from openai import OpenAI

client = OpenAI(
    base_url="${base}",
    api_key="${key}",
)
res = client.chat.completions.create(
    model="${model}",
    messages=[{"role": "user", "content": "Hello"}],
)
print(res.choices[0].message.content)`,
    js: `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "${base}",
  apiKey: process.env.API_KEY,
});

const res = await client.chat.completions.create({
  model: "${model}",
  messages: [{ role: "user", content: "Hello" }],
});
console.log(res.choices[0].message.content);`
  };
}

function limitTiles(p) {
  const l = p.limits || {};
  const tiles = [];
  if (l.rpm != null) tiles.push(["RPM", full(l.rpm)]);
  if (l.rpd != null) tiles.push(["RPD", full(l.rpd)]);
  if (l.tpm != null) tiles.push(["TPM", full(l.tpm)]);
  if (l.tpd != null) tiles.push(["TPD", full(l.tpd)]);

  const html = tiles
    .map(([k, v]) => `<div class="p-limit"><span>${k}</span><b>${esc(v)}</b></div>`)
    .join("");

  return `<div class="p-limits">${html}${
    l.text ? `<div class="p-limits-note">${esc(l.text)}</div>` : ""
  }</div>`;
}

let activeProvider = null;
let snippetTab = "curl";

function openPanel(id, pushHash = true) {
  const p = state.all.find((x) => x.id === id);
  if (!p) return;

  activeProvider = p;
  snippetTab = "curl";

  el.panelBadge.textContent = ACCESS[p.access]?.label || p.access;
  el.panelBadge.dataset.access = p.access;
  el.panelTitle.textContent = p.name;
  el.panelVendor.textContent = `${p.vendor} · ${p.kind}`;

  const samples = codeSamples(p);
  const favOn = state.favs.has(p.id);

  el.panelBody.innerHTML = `
    <div class="p-section">
      <p>${esc(p.summary)}</p>
    </div>

    <div class="p-section">
      <h3>Free allowance</h3>
      ${limitTiles(p)}
    </div>

    <div class="p-section">
      <h3>At a glance</h3>
      <div class="p-flags">
        <span class="flag ${p.openaiCompatible ? "yes" : "no"}">${p.openaiCompatible ? "✓" : "×"} OpenAI-compatible</span>
        <span class="flag ${p.creditCard ? "no" : "yes"}">${p.creditCard ? "×" : "✓"} No credit card</span>
        <span class="flag">${esc(p.regions)}</span>
        ${(p.tags || []).map((t) => `<span class="flag">${esc(t)}</span>`).join("")}
      </div>
    </div>

    <div class="p-section">
      <h3>Models mentioned</h3>
      <div class="p-models">${(p.models || []).map((m) => `<span class="model-tag">${esc(m)}</span>`).join("")}</div>
    </div>

    <div class="p-section">
      <h3>Quickstart</h3>
      <div class="tabs" role="tablist">
        ${["curl", "python", "js"].map((t) => `
          <button class="tab ${t === snippetTab ? "is-active" : ""}" role="tab"
                  aria-selected="${t === snippetTab}" data-tab="${t}">${t === "js" ? "node" : t}</button>`).join("")}
      </div>
      <div class="code-block">
        <pre><code data-code></code></pre>
        <button class="copy-btn" type="button" data-copy>copy</button>
      </div>
    </div>

    <div class="p-section">
      <h3>Links</h3>
      <div class="p-links">
        <a class="p-link primary" href="${esc(p.signup)}" target="_blank" rel="noopener">Get your key ↗</a>
        <a class="p-link" href="${esc(p.docs)}" target="_blank" rel="noopener">Docs</a>
        <a class="p-link" href="${esc(p.pricing)}" target="_blank" rel="noopener">Pricing</a>
        <button class="p-link" type="button" data-fav-toggle>${favOn ? "★ Saved" : "☆ Save"}</button>
      </div>
    </div>

    <div class="p-section">
      <h3>Worth knowing</h3>
      <div class="p-note">${esc(p.notes)}</div>
    </div>

    <div class="p-section">
      <h3>Test your own key</h3>
      <div class="tester">
        <div class="tester-head">
          <span class="tester-title">Live check against <code>${esc(p.apiBase)}/models</code></span>
        </div>
        <div class="tester-row">
          <input type="password" data-key-input placeholder="Paste your ${esc(p.name)} API key" autocomplete="off" spellcheck="false" />
          <button class="test-btn" type="button" data-test>Test</button>
        </div>
        <div class="test-result" data-test-result></div>
        <p class="tester-hint">
          The request goes from your browser straight to ${esc(p.vendor)}. The key is held in memory only,
          never written to storage, and discarded when you close this panel. Some providers block
          browser-origin requests via CORS — a CORS failure here does not mean your key is invalid.
        </p>
      </div>
    </div>

    <div class="p-meta">
      <span>verified ${esc(fmtDate(p.verified))}</span>
      <span>confidence: ${esc(p.confidence)}</span>
      <span>id: ${esc(p.id)}</span>
    </div>`;

  updateSnippet(samples);

  el.scrim.hidden = false;
  el.panel.hidden = false;
  document.body.classList.add("panel-open");
  el.panelClose.focus({ preventScroll: true });

  if (pushHash) history.replaceState(null, "", `#${p.id}`);
}

function updateSnippet(samples) {
  const pre = el.panelBody.querySelector("[data-code]");
  if (pre) pre.textContent = samples[snippetTab];
}

function closePanel() {
  el.panel.hidden = true;
  el.scrim.hidden = true;
  document.body.classList.remove("panel-open");
  activeProvider = null;
  const keyInput = el.panelBody.querySelector("[data-key-input]");
  if (keyInput) keyInput.value = "";
  el.panelBody.innerHTML = "";
  history.replaceState(null, "", location.pathname + location.search);
}

/* ---------- key tester ---------- */

async function testKey(provider, key) {
  const result = el.panelBody.querySelector("[data-test-result]");
  const btn = el.panelBody.querySelector("[data-test]");
  if (!result || !btn) return;

  const show = (cls, msg) => {
    result.className = `test-result show ${cls}`;
    result.textContent = msg;
  };

  if (!key) { show("err", "Enter a key first."); return; }

  btn.disabled = true;
  show("busy", "Contacting provider…");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);

  try {
    const res = await fetch(`${provider.apiBase}/models`, {
      method: "GET",
      headers: { Authorization: `Bearer ${key}` },
      signal: controller.signal
    });

    if (res.ok) {
      let names = [];
      try {
        const json = await res.json();
        const arr = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];
        names = arr.map((m) => m.id || m.name).filter(Boolean);
      } catch { /* body was not JSON — still a valid HTTP 200 */ }

      show("ok", `Key accepted · HTTP ${res.status}${names.length ? ` · ${names.length} models visible · ${names.slice(0, 3).join(", ")}` : ""}`);
    } else if (res.status === 401 || res.status === 403) {
      show("err", `Rejected · HTTP ${res.status}. The key is invalid, expired, or lacks scope.`);
    } else if (res.status === 429) {
      show("err", "HTTP 429 — the key works but you are rate limited right now.");
    } else {
      show("err", `Unexpected response · HTTP ${res.status} ${res.statusText}`);
    }
  } catch (err) {
    if (err.name === "AbortError") {
      show("err", "Timed out after 12s. The provider may be slow, or the request was blocked.");
    } else {
      show("err", "Request blocked before a response was read — almost always CORS. The key itself is untested; try the same call from a server or CLI.");
    }
  } finally {
    clearTimeout(timer);
    btn.disabled = false;
  }
}

/* ---------- theme ---------- */

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem(LS_THEME, theme); } catch { /* ignore */ }
}

/* ---------- export ---------- */

function exportCsv() {
  const list = currentResults();
  const cols = ["id", "name", "vendor", "access", "kind", "rpm", "rpd", "tpm", "tpd", "limits_text",
    "openai_compatible", "credit_card_required", "regions", "api_base", "signup", "docs", "verified", "confidence"];

  const cell = (v) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const rows = [cols.join(",")];
  for (const p of list) {
    rows.push([
      p.id, p.name, p.vendor, p.access, p.kind,
      p.limits?.rpm ?? "", p.limits?.rpd ?? "", p.limits?.tpm ?? "", p.limits?.tpd ?? "",
      p.limits?.text ?? "", p.openaiCompatible, p.creditCard, p.regions,
      p.apiBase, p.signup, p.docs, p.verified, p.confidence
    ].map(cell).join(","));
  }

  const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `freetier-radar-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ---------- events ---------- */

function wireEvents() {
  el.search.addEventListener("input", debounce(() => {
    state.query = el.search.value;
    el.clearSearch.hidden = !el.search.value;
    render();
  }, 90));

  el.clearSearch.addEventListener("click", () => {
    el.search.value = "";
    state.query = "";
    el.clearSearch.hidden = true;
    el.search.focus();
    render();
  });

  el.accessChips.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-access]");
    if (!btn) return;
    const key = btn.dataset.access;
    state.access.has(key) ? state.access.delete(key) : state.access.add(key);
    render();
  });

  el.flagChips.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-flag]");
    if (!btn) return;
    const key = btn.dataset.flag;
    state.flags.has(key) ? state.flags.delete(key) : state.flags.add(key);
    render();
  });

  el.sort.addEventListener("change", () => { state.sort = el.sort.value; render(); });

  document.querySelectorAll("[data-view]").forEach((btn) => {
    btn.addEventListener("click", () => setView(btn.dataset.view));
  });

  el.resetBtn.addEventListener("click", resetAll);
  $("#emptyReset").addEventListener("click", resetAll);

  function resetAll() {
    state.query = "";
    state.access.clear();
    state.flags.clear();
    state.sort = "relevance";
    el.search.value = "";
    el.sort.value = "relevance";
    el.clearSearch.hidden = true;
    render();
  }

  // cards + table rows open the panel
  el.grid.addEventListener("click", (e) => {
    const favBtn = e.target.closest("[data-fav]");
    if (favBtn) {
      e.stopPropagation();
      toggleFav(favBtn.dataset.fav);
      return;
    }
    const card = e.target.closest(".card");
    if (card) openPanel(card.dataset.id);
  });

  el.grid.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const card = e.target.closest(".card");
    if (!card || e.target.closest("[data-fav]")) return;
    e.preventDefault();
    openPanel(card.dataset.id);
  });

  el.tableBody.addEventListener("click", (e) => {
    const row = e.target.closest("tr[data-id]");
    if (row) openPanel(row.dataset.id);
  });
  el.tableBody.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const row = e.target.closest("tr[data-id]");
    if (row) openPanel(row.dataset.id);
  });

  el.panelClose.addEventListener("click", closePanel);
  el.scrim.addEventListener("click", closePanel);

  el.panelBody.addEventListener("click", (e) => {
    const tab = e.target.closest("[data-tab]");
    if (tab && activeProvider) {
      snippetTab = tab.dataset.tab;
      el.panelBody.querySelectorAll("[data-tab]").forEach((t) => {
        const on = t === tab;
        t.classList.toggle("is-active", on);
        t.setAttribute("aria-selected", String(on));
      });
      updateSnippet(codeSamples(activeProvider));
      return;
    }

    const copy = e.target.closest("[data-copy]");
    if (copy) {
      const code = el.panelBody.querySelector("[data-code]")?.textContent || "";
      navigator.clipboard?.writeText(code).then(() => {
        copy.textContent = "copied";
        copy.classList.add("is-done");
        setTimeout(() => { copy.textContent = "copy"; copy.classList.remove("is-done"); }, 1400);
      }).catch(() => { copy.textContent = "failed"; });
      return;
    }

    const favToggle = e.target.closest("[data-fav-toggle]");
    if (favToggle && activeProvider) {
      toggleFav(activeProvider.id);
      favToggle.textContent = state.favs.has(activeProvider.id) ? "★ Saved" : "☆ Save";
      return;
    }

    const test = e.target.closest("[data-test]");
    if (test && activeProvider) {
      const input = el.panelBody.querySelector("[data-key-input]");
      testKey(activeProvider, input?.value.trim() || "");
    }
  });

  el.panelBody.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.matches("[data-key-input]") && activeProvider) {
      e.preventDefault();
      testKey(activeProvider, e.target.value.trim());
    }
  });

  el.exportBtn.addEventListener("click", exportCsv);

  el.themeBtn.addEventListener("click", () => {
    applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
  });

  document.addEventListener("keydown", (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "");

    if (e.key === "Escape") {
      if (!el.panel.hidden) closePanel();
      else if (document.activeElement === el.search) { el.search.value = ""; state.query = ""; el.clearSearch.hidden = true; render(); el.search.blur(); }
      return;
    }

    if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      el.search.focus();
      el.search.select();
      return;
    }

    // focus trap for the dialog
    if (e.key === "Tab" && !el.panel.hidden) {
      const focusables = el.panel.querySelectorAll('a[href], button:not([disabled]), input, [tabindex]:not([tabindex="-1"])');
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
}

function toggleFav(id) {
  state.favs.has(id) ? state.favs.delete(id) : state.favs.add(id);
  saveFavs();
  render();
  if (activeProvider && activeProvider.id === id) {
    const btn = el.panelBody.querySelector("[data-fav-toggle]");
    if (btn) btn.textContent = state.favs.has(id) ? "★ Saved" : "☆ Save";
  }
}

/* ---------- boot ---------- */

async function boot() {
  const savedTheme = (() => { try { return localStorage.getItem(LS_THEME); } catch { return null; } })();
  applyTheme(savedTheme === "light" ? "light" : "dark");

  try {
    const res = await fetch(DATA_URL, { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    state.all = Array.isArray(json.providers) ? json.providers : [];
    state.meta = json.meta || {};
  } catch (err) {
    console.error("Dataset load failed:", err);
    el.loadError.hidden = false;
    el.resultCount.textContent = "dataset unavailable";
    return;
  }

  INDEX = buildIndex(state.all);
  renderStats();
  wireEvents();

  // ?view=table makes the compact view directly shareable
  const params = new URLSearchParams(location.search);
  setView(params.get("view"));

  // deep link: #groq
  const id = location.hash.replace(/^#/, "");
  if (id && state.all.some((p) => p.id === id)) openPanel(id, false);
}

boot();
