// =======================
//  MUSICALA - PIANO
//  Repertorio dinámico por encabezados (TSV)
//  - Detecta automáticamente columnas “Guía” según el ORDEN del Sheet
//  - Columnas fijas por alias: Nombre, Artista, Género, Nivel, Tonalidad, Contenido
// =======================

'use strict';

// TSV recomendado (menos drama que CSV)
const DATA_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vQCSexe6ZgBbSKrzyhCkq-64aLrsu6SWqVhhiuccf3EhoMHcP_oxBLdGyZWONcHl861LrX6ZltEu3O3/pub?gid=0&single=true&output=tsv";

/*
  Si por alguna razón SOLO tienes CSV:
  const DATA_URL = "TU_URL_PUBLICA&output=csv";
*/

// Columnas “fijas” (metadata). Todo lo demás se vuelve “Guía” en el orden del Sheet.
const COL_NAME_ALIASES = {
  name: ["nombre de la canción", "nombre", "canción", "cancion", "song", "title", "título", "titulo"],
  artist: ["artista", "autor", "composer", "compositor"],
  genre: ["género", "genero", "genre"],
  level: ["nivel", "dificultad", "level"],
  key: ["tonalidad", "key", "tonality", "armadura"],
  content: ["contenido", "observaciones", "comentarios", "notas internas", "content", "notes"],
};

// LocalStorage (para que Piano no se mezcle con otros instrumentos)
const LS = {
  guide: "musicala_piano_guide",
  view: "musicala_piano_view",
  sort: "musicala_piano_sort",
  levelMin: "musicala_piano_level_min",
  progress: "musicala_piano_progress_v1",
};

let rows = [];         // matriz completa (incluye encabezado)
let groups = [];       // canciones agrupadas (por nombre)
let headerNorm = [];   // encabezados normalizados (para matching)
let col = {};          // índices columnas fijas
let guideDefs = [];    // [{ key, label, idx }]
let guideCols = {};    // { key: idx }

let state = {
  guide: "",           // key de guideDefs
  view: "cards",       // cards | table
  search: "",
  sort: "name-asc",
  levelMin: 0,
};

let progress = {};     // { songKey: "doing" | "done" }

const $ = (id) => document.getElementById(id);

// ---------- Helpers ----------
function escapeHTML(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeHeader(s = "") {
  return String(s)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[._-]+/g, " ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, ""); // quita tildes
}

function normalizeKey(s = "") {
  return String(s).trim().toLowerCase().replace(/\s+/g, " ");
}

function isLink(val = "") {
  return /^https?:\/\//i.test(String(val).trim());
}

// Nivel: soporta "★★★", "3", "Nivel 3", "3/5", "3 - medio", etc.
function parseLevel(val = "") {
  const s = String(val || "").trim();
  if (!s) return 0;

  // estrellas
  if (s.includes("★")) {
    let c = 0;
    for (const ch of s) if (ch === "★") c++;
    return clamp(c, 0, 5);
  }

  // número explícito
  const m = s.match(/(\d+)/);
  if (m) return clamp(Number(m[1]), 0, 5);

  return 0;
}

function clamp(n, a, b) {
  const x = Number.isFinite(n) ? n : a;
  return Math.max(a, Math.min(b, x));
}

// TSV parse simple
function parseTSV(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
  return lines.map((line) => line.split("\t"));
}

// CSV parse simple (NO RFC completo, evita comas en comillas, etc.)
function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
  return lines.map((line) => line.split(","));
}

function findColIndex(aliases) {
  for (const a of aliases) {
    const target = normalizeHeader(a);
    const idx = headerNorm.findIndex((h) => h === target);
    if (idx >= 0) return idx;
  }
  return -1;
}

function buildColumnMap(headersRow) {
  headerNorm = headersRow.map(normalizeHeader);

  col = {
    name: findColIndex(COL_NAME_ALIASES.name),
    artist: findColIndex(COL_NAME_ALIASES.artist),
    genre: findColIndex(COL_NAME_ALIASES.genre),
    level: findColIndex(COL_NAME_ALIASES.level),
    key: findColIndex(COL_NAME_ALIASES.key),
    content: findColIndex(COL_NAME_ALIASES.content),
  };

  // fallback mínimo: si no encuentra "nombre", usa la primera columna
  if (col.name < 0) col.name = 0;

  // Guías: todo lo que NO sea columna fija
  const fixed = new Set(
    [col.name, col.artist, col.genre, col.level, col.key, col.content]
      .filter((i) => i != null && i >= 0)
  );

  guideDefs = [];
  guideCols = {};

  headersRow.forEach((rawLabel, idx) => {
    if (fixed.has(idx)) return;
    const label = String(rawLabel || "").trim();
    if (!label) return;

    // Key estable, simple y única
    const key = `G${idx}`;

    guideDefs.push({ key, label, idx });
    guideCols[key] = idx;
  });

  // si el sheet no tiene guías (raro), dejamos una dummy
  if (!guideDefs.length) {
    const key = "G0";
    guideDefs = [{ key, label: "Guía", idx: -1 }];
    guideCols = { [key]: -1 };
  }

  // Default guide válido
  if (!state.guide || !guideDefs.some((g) => g.key === state.guide)) {
    state.guide = guideDefs[0].key;
  }
}

// ---------- State ----------
function loadState() {
  const g = localStorage.getItem(LS.guide);
  const v = localStorage.getItem(LS.view);
  const s = localStorage.getItem(LS.sort);
  const lm = localStorage.getItem(LS.levelMin);
  const p = localStorage.getItem(LS.progress);

  if (g) state.guide = g;
  if (v === "cards" || v === "table") state.view = v;
  if (s) state.sort = s;
  if (lm && !Number.isNaN(Number(lm))) state.levelMin = Number(lm);

  if (p) {
    try { progress = JSON.parse(p) || {}; }
    catch { progress = {}; }
  }
}

function persistState() {
  localStorage.setItem(LS.guide, state.guide);
  localStorage.setItem(LS.view, state.view);
  localStorage.setItem(LS.sort, state.sort);
  localStorage.setItem(LS.levelMin, String(state.levelMin));
  localStorage.setItem(LS.progress, JSON.stringify(progress));
}

function setStatus(msg = "") {
  $("statusLabel").textContent = msg;
}

// ---------- UI ----------
function setView(view) {
  state.view = view;

  $("cardsView").classList.toggle("hidden", view !== "cards");
  $("tableView").classList.toggle("hidden", view !== "table");

  $("viewCardsBtn").classList.toggle("active", view === "cards");
  $("viewTableBtn").classList.toggle("active", view === "table");

  persistState();
}

function refreshGuideSelect() {
  const sel = $("guideSelect");
  sel.innerHTML = "";

  for (const g of guideDefs) {
    const opt = document.createElement("option");
    opt.value = g.key;
    opt.textContent = g.label;
    sel.appendChild(opt);
  }

  if (!guideDefs.some((x) => x.key === state.guide)) state.guide = guideDefs[0].key;
  sel.value = state.guide;
}

function updateMeta(visible, total) {
  $("countPill").textContent = `Mostrando ${visible} de ${total}`;
  const done = Object.values(progress).filter((v) => v === "done").length;
  $("progressPill").textContent = `Progreso: ${done} / ${total}`;
}

function setEmptyCards(show) { $("emptyCards").classList.toggle("hidden", !show); }
function setEmptyTable(show) { $("emptyTable").classList.toggle("hidden", !show); }

// ---------- Data transform ----------
function groupSongs(dataRows) {
  const map = new Map();

  for (const r of dataRows) {
    const name = (r[col.name] || "").trim();
    if (!name) continue;

    const key = normalizeKey(name);

    if (!map.has(key)) {
      map.set(key, {
        key,
        name,
        artist: col.artist >= 0 ? (r[col.artist] || "").trim() : "",
        genre: col.genre >= 0 ? (r[col.genre] || "").trim() : "",
        keySig: col.key >= 0 ? (r[col.key] || "").trim() : "",
        levelRaw: col.level >= 0 ? (r[col.level] || "").trim() : "",
        levelNum: col.level >= 0 ? parseLevel(r[col.level] || "") : 0,
        content: col.content >= 0 ? (r[col.content] || "").trim() : "",
        versions: {}, // { guideKey: val }
      });
    }

    const item = map.get(key);

    // Mejor metadata si vienen filas repetidas
    if (col.level >= 0) {
      const lvl = parseLevel(r[col.level] || "");
      if (lvl > item.levelNum) {
        item.levelNum = lvl;
        item.levelRaw = (r[col.level] || "").trim();
      }
    }
    if (col.artist >= 0 && !item.artist && r[col.artist]) item.artist = (r[col.artist] || "").trim();
    if (col.genre >= 0 && !item.genre && r[col.genre]) item.genre = (r[col.genre] || "").trim();
    if (col.key >= 0 && !item.keySig && r[col.key]) item.keySig = (r[col.key] || "").trim();
    if (col.content >= 0 && !item.content && r[col.content]) item.content = (r[col.content] || "").trim();

    // Versiones por guía (en el orden del sheet, pero almacenadas por key)
    for (const g of guideDefs) {
      const idx = g.idx;
      if (idx == null || idx < 0) continue;
      const val = (r[idx] || "").trim();
      if (val && !item.versions[g.key]) item.versions[g.key] = val;
    }
  }

  return [...map.values()];
}

function matchesSearch(item, term) {
  if (!term) return true;
  const t = term.toLowerCase();
  const hay = `${item.name} ${item.artist} ${item.genre} ${item.keySig}`.toLowerCase();
  return hay.includes(t);
}

function sortItems(items) {
  const by = state.sort;
  const copy = [...items];

  copy.sort((a, b) => {
    if (by === "name-asc") return a.name.localeCompare(b.name, "es", { sensitivity: "base" });
    if (by === "name-desc") return b.name.localeCompare(a.name, "es", { sensitivity: "base" });
    if (by === "level-asc") return a.levelNum - b.levelNum || a.name.localeCompare(b.name, "es", { sensitivity: "base" });
    if (by === "level-desc") return b.levelNum - a.levelNum || a.name.localeCompare(b.name, "es", { sensitivity: "base" });
    if (by === "genre-asc") return (a.genre || "").localeCompare(b.genre || "", "es", { sensitivity: "base" });
    return 0;
  });

  return copy;
}

function levelDisplay(item) {
  // si el sheet trae estrellas, muéstralas. Si trae número, conviértelo a estrellas.
  const raw = (item.levelRaw || "").trim();
  if (raw.includes("★")) return raw;
  const n = clamp(item.levelNum, 0, 5);
  return n ? "★".repeat(n) : "—";
}

// ---------- Modal ----------
function openModal(item, guideKey) {
  const g = guideDefs.find((x) => x.key === guideKey);
  const val = (item.versions[guideKey] || "").trim();

  const metaParts = [
    item.artist || "—",
    item.genre || "—",
    item.keySig ? `Tonalidad: ${item.keySig}` : null,
    `Nivel: ${levelDisplay(item)}`
  ].filter(Boolean);

  $("modalTitle").textContent = item.name;
  $("modalMeta").textContent = metaParts.join(" · ");

  if (!val) {
    $("modalContent").textContent = "Esta versión aún no está disponible.";
    $("modalAction").innerHTML = "";
  } else if (isLink(val)) {
    const label = g ? g.label : "Recurso";
    $("modalContent").textContent =
      `Guía: ${label}\n\nRecurso externo listo para abrir.`;
    $("modalAction").innerHTML = `
      <a class="btnLink" href="${escapeHTML(val)}" target="_blank" rel="noopener noreferrer">
        Abrir ${escapeHTML(label)}
      </a>`;
  } else {
    $("modalContent").textContent = val;
    $("modalAction").innerHTML = "";
  }

  $("modalOverlay").classList.remove("hidden");
}

function closeModal() {
  $("modalOverlay").classList.add("hidden");
}

// ---------- Render: Cards ----------
function renderCards() {
  const grid = $("cardsGrid");
  grid.innerHTML = "";

  const term = state.search.trim();
  let items = groups
    .filter((it) => it.levelNum >= state.levelMin)
    .filter((it) => matchesSearch(it, term));

  items = sortItems(items);

  updateMeta(items.length, groups.length);
  setEmptyCards(items.length === 0);

  for (const it of items) {
    const card = document.createElement("div");
    card.className = "card";

    const p = progress[it.key] || "none";

    // Botones de versiones en el ORDEN del Sheet
    const vBtns = guideDefs
      .map((g) => {
        const has = !!(it.versions[g.key] || "").trim();
        const on = g.key === state.guide ? "on" : "";
        return `<button class="vbtn ${on}" data-song="${escapeHTML(it.key)}" data-guide="${g.key}" ${
          has ? "" : "disabled"
        } title="${has ? "Abrir" : "No disponible"}">${escapeHTML(g.label)}</button>`;
      })
      .join("");

    const doingActive = p === "doing" ? "active" : "";
    const doneActive = p === "done" ? "active" : "";

    card.innerHTML = `
      <div class="card__title">${escapeHTML(it.name)}</div>

      <div class="card__meta">
        <span class="badge">👤 ${escapeHTML(it.artist || "—")}</span>
        <span class="badge">🏷️ ${escapeHTML(it.genre || "—")}</span>
        <span class="badge">🎼 ${escapeHTML(it.keySig || "—")}</span>
        <span class="badge">⭐ ${escapeHTML(levelDisplay(it))}</span>
      </div>

      <div class="versions">${vBtns}</div>

      <div class="progressRow">
        <button class="pbtn ${doingActive}" data-prog="doing" data-song="${escapeHTML(it.key)}">⭐ En proceso</button>
        <button class="pbtn ${doneActive}" data-prog="done" data-song="${escapeHTML(it.key)}">✅ Lograda</button>
      </div>
    `;

    grid.appendChild(card);
  }

  // Delegación de eventos (1 sola vez por render)
  grid.onclick = (e) => {
    const v = e.target.closest(".vbtn");
    if (v && !v.disabled) {
      const key = v.dataset.song;
      const guide = v.dataset.guide;
      const item = groups.find((x) => x.key === key);
      if (item) openModal(item, guide);
      return;
    }

    const pb = e.target.closest(".pbtn");
    if (pb) {
      const key = pb.dataset.song;
      const next = pb.dataset.prog;
      if (progress[key] === next) delete progress[key];
      else progress[key] = next;
      persistState();
      renderCards();
    }
  };
}

// ---------- Render: Table ----------
function renderTable() {
  const headerRow = $("headerRow");
  const tbody = $("tableBody");
  headerRow.innerHTML = "";
  tbody.innerHTML = "";

  const guideIdx = guideCols[state.guide];

  // columnas fijas (si no existe una, no la mostramos)
  const fixedIdxs = [col.name, col.artist, col.genre, col.level, col.key, col.content]
    .filter((i) => i != null && i >= 0);

  // headers fijos
  for (const i of fixedIdxs) {
    const th = document.createElement("th");
    th.textContent = rows[0][i] || "";
    headerRow.appendChild(th);
  }

  // header extra (guía seleccionada)
  const thx = document.createElement("th");
  if (guideIdx != null && guideIdx >= 0) {
    thx.textContent = rows[0][guideIdx] || "Guía";
  } else {
    const g = guideDefs.find((x) => x.key === state.guide);
    thx.textContent = (g && g.label) || "Guía";
  }
  headerRow.appendChild(thx);

  const term = state.search.trim().toLowerCase();

  // filas filtradas
  let dataRows = rows.slice(1).filter((r) => {
    const lvl = col.level >= 0 ? parseLevel(r[col.level] || "") : 0;
    if (lvl < state.levelMin) return false;

    if (!term) return true;
    const hay = `${r[col.name] || ""} ${col.artist >= 0 ? r[col.artist] || "" : ""} ${
      col.genre >= 0 ? r[col.genre] || "" : ""
    } ${col.key >= 0 ? r[col.key] || "" : ""}`.toLowerCase();

    return hay.includes(term);
  });

  // orden
  dataRows.sort((a, b) => {
    const an = a[col.name] || "";
    const bn = b[col.name] || "";
    const al = col.level >= 0 ? parseLevel(a[col.level] || "") : 0;
    const bl = col.level >= 0 ? parseLevel(b[col.level] || "") : 0;
    const ag = col.genre >= 0 ? a[col.genre] || "" : "";
    const bg = col.genre >= 0 ? b[col.genre] || "" : "";

    if (state.sort === "name-asc") return an.localeCompare(bn, "es", { sensitivity: "base" });
    if (state.sort === "name-desc") return bn.localeCompare(an, "es", { sensitivity: "base" });
    if (state.sort === "level-asc") return al - bl || an.localeCompare(bn, "es", { sensitivity: "base" });
    if (state.sort === "level-desc") return bl - al || an.localeCompare(bn, "es", { sensitivity: "base" });
    if (state.sort === "genre-asc") return ag.localeCompare(bg, "es", { sensitivity: "base" });
    return 0;
  });

  $("countPill").textContent = `Mostrando ${dataRows.length} filas`;
  setEmptyTable(dataRows.length === 0);

  for (const r of dataRows) {
    const tr = document.createElement("tr");

    for (const i of fixedIdxs) {
      const td = document.createElement("td");
      td.textContent = (r[i] || "").trim();
      tr.appendChild(td);
    }

    const tdExtra = document.createElement("td");
    const val = guideIdx != null && guideIdx >= 0 ? (r[guideIdx] || "").trim() : "";
    if (val && isLink(val)) {
      tdExtra.innerHTML = `<a href="${escapeHTML(val)}" target="_blank" rel="noopener noreferrer">Abrir</a>`;
    } else {
      tdExtra.textContent = val || "";
    }
    tr.appendChild(tdExtra);

    tbody.appendChild(tr);
  }
}

// ---------- Rerender ----------
function rerender() {
  persistState();
  if (state.view === "cards") renderCards();
  else renderTable();
}

// ---------- Init ----------
async function init() {
  loadState();

  // UI base
  $("sortSelect").value = state.sort;
  $("levelMin").value = String(state.levelMin);
  setView(state.view);

  setStatus("Cargando repertorio…");

  try {
    const res = await fetch(DATA_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();

    const isTSV = DATA_URL.includes("output=tsv");
    rows = isTSV ? parseTSV(text) : parseCSV(text);

    if (!rows.length) throw new Error("Datos vacíos");
    if (!rows[0] || rows[0].length < 1) throw new Error("Encabezado inválido");

    buildColumnMap(rows[0]);
    refreshGuideSelect();

    groups = groupSongs(rows.slice(1));

    setStatus("");
    rerender();
  } catch (e) {
    console.error(e);
    setStatus("No se pudo cargar el repertorio 😵");
    $("countPill").textContent = "Error cargando datos";
    $("progressPill").textContent = "Progreso: —";
  }

  // Botones vista
  $("viewCardsBtn").onclick = () => {
    setView("cards");
    rerender();
  };
  $("viewTableBtn").onclick = () => {
    setView("table");
    rerender();
  };

  // Filtros
  $("guideSelect").onchange = (e) => {
    state.guide = e.target.value;
    rerender();
  };
  $("sortSelect").onchange = (e) => {
    state.sort = e.target.value;
    rerender();
  };
  $("levelMin").onchange = (e) => {
    state.levelMin = Number(e.target.value || 0);
    rerender();
  };

  // Search debounce
  let t = null;
  $("searchInput").addEventListener("input", (e) => {
    clearTimeout(t);
    t = setTimeout(() => {
      state.search = e.target.value;
      rerender();
    }, 140);
  });

  $("clearBtn").onclick = () => {
    $("searchInput").value = "";
    state.search = "";
    rerender();
    $("searchInput").focus();
  };

  // Modal
  $("modalClose").onclick = closeModal;
  $("modalOverlay").addEventListener("click", (e) => {
    if (e.target.id === "modalOverlay") closeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });
}

init();
