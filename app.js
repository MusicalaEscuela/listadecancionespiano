'use strict';

/* ==========================================================================
   MUSICALA · REPERTORIO PARA PIANO
   --------------------------------------------------------------------------
   App estática con:
   - Datos desde Google Sheets publicado como TSV
   - Búsqueda inteligente
   - Filtros rápidos
   - Progreso en localStorage
   - Favoritos en localStorage
   - Recientes en localStorage
   - Vista tarjetas y vista tabla
========================================================================== */

/* ==========================================================================
   Configuración
========================================================================== */

// TSV recomendado. Menos drama que CSV, que ya bastante hay con leer partituras.
const DATA_URL =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vQCSexe6ZgBbSKrzyhCkq-64aLrsu6SWqVhhiuccf3EhoMHcP_oxBLdGyZWONcHl861LrX6ZltEu3O3/pub?gid=0&single=true&output=tsv';

// Columnas fijas por alias. Todo lo demás se interpreta como columna de guía/recurso.
const COL_NAME_ALIASES = {
  name: [
    'nombre de la canción',
    'nombre de la cancion',
    'nombre',
    'canción',
    'cancion',
    'song',
    'title',
    'título',
    'titulo'
  ],
  artist: [
    'artista',
    'autor',
    'composer',
    'compositor'
  ],
  genre: [
    'género',
    'genero',
    'genre'
  ],
  level: [
    'nivel',
    'dificultad',
    'level'
  ],
  key: [
    'tonalidad',
    'key',
    'tonality',
    'armadura'
  ],
  content: [
    'contenido',
    'observaciones',
    'comentarios',
    'notas internas',
    'content',
    'notes'
  ]
};

const LS = {
  guide: 'musicala_piano_guide',
  view: 'musicala_piano_view',
  sort: 'musicala_piano_sort',
  levelMin: 'musicala_piano_level_min',
  progressFilter: 'musicala_piano_progress_filter',
  progress: 'musicala_piano_progress_v1',
  favorites: 'musicala_piano_favorites_v1',
  recent: 'musicala_piano_recent_v1'
};

const PROGRESS = {
  NONE: 'none',
  IN_PROGRESS: 'in-progress',
  DONE: 'done'
};

const PROGRESS_FILTERS = new Set([
  'all',
  'in-progress',
  'done',
  'favorites'
]);

const SORTS = new Set([
  'name-asc',
  'name-desc',
  'level-asc',
  'level-desc',
  'genre-asc'
]);

const MAX_RECENT = 8;

/* ==========================================================================
   Estado
========================================================================== */

let rows = [];
let groups = [];
let headerNorm = [];
let col = {};
let guideDefs = [];
let guideCols = {};

let state = {
  guide: '',
  view: 'cards',
  search: '',
  sort: 'name-asc',
  levelMin: 0,
  progressFilter: 'all'
};

let progress = {};
let favorites = new Set();
let recent = [];

/* ==========================================================================
   DOM helpers
========================================================================== */

const $ = (id) => document.getElementById(id);

function requiredEl(id) {
  const el = $(id);

  if (!el) {
    throw new Error(`No se encontró el elemento #${id}. El HTML y el JS no están hablando. Qué sorpresa tan desagradable.`);
  }

  return el;
}

const dom = {
  get searchInput() { return requiredEl('searchInput'); },
  get clearBtn() { return requiredEl('clearBtn'); },

  get guideSelect() { return requiredEl('guideSelect'); },
  get sortSelect() { return requiredEl('sortSelect'); },
  get levelMin() { return requiredEl('levelMin'); },

  get filterAllBtn() { return requiredEl('filterAllBtn'); },
  get filterInProgressBtn() { return requiredEl('filterInProgressBtn'); },
  get filterDoneBtn() { return requiredEl('filterDoneBtn'); },
  get filterFavoritesBtn() { return requiredEl('filterFavoritesBtn'); },

  get countPill() { return requiredEl('countPill'); },
  get progressPill() { return requiredEl('progressPill'); },
  get statusLabel() { return requiredEl('statusLabel'); },

  get viewCardsBtn() { return requiredEl('viewCardsBtn'); },
  get viewTableBtn() { return requiredEl('viewTableBtn'); },
  get cardsView() { return requiredEl('cardsView'); },
  get tableView() { return requiredEl('tableView'); },

  get recentSection() { return requiredEl('recentSection'); },
  get recentList() { return requiredEl('recentList'); },
  get clearRecentBtn() { return requiredEl('clearRecentBtn'); },

  get cardsGrid() { return requiredEl('cardsGrid'); },
  get emptyCards() { return requiredEl('emptyCards'); },
  get emptyResetBtn() { return requiredEl('emptyResetBtn'); },

  get headerRow() { return requiredEl('headerRow'); },
  get tableBody() { return requiredEl('tableBody'); },
  get emptyTable() { return requiredEl('emptyTable'); },
  get emptyTableResetBtn() { return requiredEl('emptyTableResetBtn'); },

  get modalOverlay() { return requiredEl('modalOverlay'); },
  get modalClose() { return requiredEl('modalClose'); },
  get modalTitle() { return requiredEl('modalTitle'); },
  get modalMeta() { return requiredEl('modalMeta'); },
  get modalContent() { return requiredEl('modalContent'); },
  get modalAction() { return requiredEl('modalAction'); }
};

/* ==========================================================================
   Helpers generales
========================================================================== */

function escapeHTML(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function normalizeText(value = '') {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function normalizeHeader(value = '') {
  return normalizeText(value);
}

function cleanCell(value = '') {
  return String(value)
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Mantiene compatibilidad con progreso viejo.
// Antes la key no quitaba tildes, así que no la cambiamos para no borrar avances.
function makeSongKey(value = '') {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function clamp(number, min, max) {
  const n = Number(number);
  const safe = Number.isFinite(n) ? n : min;
  return Math.max(min, Math.min(max, safe));
}

function isLink(value = '') {
  return /^https?:\/\//i.test(String(value).trim());
}

function parseLevel(value = '') {
  const text = String(value || '').trim();

  if (!text) return 0;

  if (text.includes('★')) {
    let count = 0;

    for (const char of text) {
      if (char === '★') count += 1;
    }

    return clamp(count, 0, 5);
  }

  const match = text.match(/(\d+)/);

  if (match) {
    return clamp(Number(match[1]), 0, 5);
  }

  return 0;
}

function levelDisplay(item) {
  const raw = String(item.levelRaw || '').trim();

  if (raw.includes('★')) return raw;

  const level = clamp(item.levelNum, 0, 5);
  return level ? '★'.repeat(level) : '—';
}

function getProgressStatus(songKey) {
  const value = progress[songKey];

  if (value === 'doing') return PROGRESS.IN_PROGRESS;
  if (value === 'progress') return PROGRESS.IN_PROGRESS;
  if (value === PROGRESS.IN_PROGRESS) return PROGRESS.IN_PROGRESS;
  if (value === PROGRESS.DONE) return PROGRESS.DONE;

  return PROGRESS.NONE;
}

function setProgressStatus(songKey, nextStatus) {
  if (!songKey) return;

  if (nextStatus === PROGRESS.NONE) {
    delete progress[songKey];
    return;
  }

  progress[songKey] = nextStatus;
}

function progressLabel(status) {
  if (status === PROGRESS.IN_PROGRESS) return 'En proceso';
  if (status === PROGRESS.DONE) return 'Lograda';
  return 'Sin iniciar';
}

function progressBadgeClass(status) {
  if (status === PROGRESS.IN_PROGRESS) return 'progressBadge--progress';
  if (status === PROGRESS.DONE) return 'progressBadge--done';
  return 'progressBadge--empty';
}

function safeLocaleCompare(a = '', b = '') {
  return String(a).localeCompare(String(b), 'es', {
    sensitivity: 'base',
    numeric: true
  });
}

/* ==========================================================================
   Parser TSV / CSV
========================================================================== */

function parseDelimited(text, delimiter = '\t') {
  const output = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  const source = String(text || '');

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    const next = source[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }

      continue;
    }

    if (char === delimiter && !inQuotes) {
      row.push(cell);
      cell = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') i += 1;

      row.push(cell);

      if (row.some((value) => String(value).trim() !== '')) {
        output.push(row);
      }

      row = [];
      cell = '';
      continue;
    }

    cell += char;
  }

  row.push(cell);

  if (row.some((value) => String(value).trim() !== '')) {
    output.push(row);
  }

  return output;
}

function parseData(text) {
  const isTSV = DATA_URL.includes('output=tsv');
  return parseDelimited(text, isTSV ? '\t' : ',');
}

function validateRows(rawRows) {
  if (!rawRows.length) return [];

  const headers = rawRows[0].map(cleanCell);
  const expectedColumns = headers.length;
  const validRows = [headers];

  rawRows.slice(1).forEach((row, index) => {
    const rowNumber = index + 2;

    if (row.length !== expectedColumns) {
      console.warn(
        `[Repertorio] Fila ${rowNumber} ignorada: se esperaban ${expectedColumns} columnas y llegaron ${row.length}.`,
        row
      );
      return;
    }

    validRows.push(row.map(cleanCell));
  });

  return validRows;
}

/* ==========================================================================
   Columnas y transformación de datos
========================================================================== */

function findColIndex(aliases) {
  for (const alias of aliases) {
    const target = normalizeHeader(alias);
    const index = headerNorm.findIndex((header) => header === target);

    if (index >= 0) return index;
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
    content: findColIndex(COL_NAME_ALIASES.content)
  };

  if (col.name < 0) col.name = 0;

  const fixedColumns = new Set(
    [
      col.name,
      col.artist,
      col.genre,
      col.level,
      col.key,
      col.content
    ].filter((index) => Number.isInteger(index) && index >= 0)
  );

  guideDefs = [];
  guideCols = {};

  headersRow.forEach((rawLabel, index) => {
    if (fixedColumns.has(index)) return;

    const label = String(rawLabel || '').trim();
    if (!label) return;

    const key = `G${index}`;

    guideDefs.push({
      key,
      label,
      idx: index
    });

    guideCols[key] = index;
  });

  if (!guideDefs.length) {
    guideDefs = [
      {
        key: 'G0',
        label: 'Guía',
        idx: -1
      }
    ];

    guideCols = {
      G0: -1
    };
  }

  if (!state.guide || !guideDefs.some((guide) => guide.key === state.guide)) {
    state.guide = guideDefs[0].key;
  }
}

function groupSongs(dataRows) {
  const map = new Map();

  for (const row of dataRows) {
    const name = cleanCell(row[col.name]);

    if (!name) continue;

    const songKey = makeSongKey(name);

    if (!map.has(songKey)) {
      map.set(songKey, {
        key: songKey,
        name,
        artist: col.artist >= 0 ? cleanCell(row[col.artist]) : '',
        genre: col.genre >= 0 ? cleanCell(row[col.genre]) : '',
        keySig: col.key >= 0 ? cleanCell(row[col.key]) : '',
        levelRaw: col.level >= 0 ? cleanCell(row[col.level]) : '',
        levelNum: col.level >= 0 ? parseLevel(row[col.level] || '') : 0,
        content: col.content >= 0 ? cleanCell(row[col.content]) : '',
        versions: {}
      });
    }

    const item = map.get(songKey);

    if (col.level >= 0) {
      const level = parseLevel(row[col.level] || '');

      if (level > item.levelNum) {
        item.levelNum = level;
        item.levelRaw = cleanCell(row[col.level]);
      }
    }

    if (col.artist >= 0 && !item.artist && row[col.artist]) {
      item.artist = cleanCell(row[col.artist]);
    }

    if (col.genre >= 0 && !item.genre && row[col.genre]) {
      item.genre = cleanCell(row[col.genre]);
    }

    if (col.key >= 0 && !item.keySig && row[col.key]) {
      item.keySig = cleanCell(row[col.key]);
    }

    if (col.content >= 0 && !item.content && row[col.content]) {
      item.content = cleanCell(row[col.content]);
    }

    for (const guide of guideDefs) {
      if (guide.idx == null || guide.idx < 0) continue;

      const value = cleanCell(row[guide.idx]);

      if (value && !item.versions[guide.key]) {
        item.versions[guide.key] = value;
      }
    }
  }

  return [...map.values()];
}

function getGuideByKey(guideKey) {
  return guideDefs.find((guide) => guide.key === guideKey) || guideDefs[0] || null;
}

function getGuideLabel(guideKey) {
  const guide = getGuideByKey(guideKey);
  return guide ? guide.label : 'Guía';
}

function getCompactGuideLabel(guideKey) {
  const label = getGuideLabel(guideKey);
  const normalized = normalizeHeader(label);

  if (normalized.includes('nivel 1') && normalized.includes('acompanamiento')) return 'Acomp. Nivel 1';
  if (normalized.includes('nivel 2') && normalized.includes('acompanamiento')) return 'Acomp. Nivel 2';
  if (normalized.includes('nivel 3') && normalized.includes('acompanamiento')) return 'Acomp. Nivel 3';
  if (normalized === 'cifrado acordes' || normalized.includes('cifrado')) return 'Acordes';
  if (normalized.includes('video tutorial')) return 'Video';

  return label;
}

function getAvailableGuides(item) {
  return guideDefs.filter((guide) => String(item.versions[guide.key] || '').trim());
}

function getBestGuideKey(item) {
  if (item.versions[state.guide]) return state.guide;

  const firstAvailable = getAvailableGuides(item)[0];
  return firstAvailable ? firstAvailable.key : state.guide;
}

function buildSearchHaystack(item) {
  const guideLabels = guideDefs.map((guide) => guide.label).join(' ');
  const resourceValues = Object.values(item.versions || {}).join(' ');

  return normalizeText([
    item.name,
    item.artist,
    item.genre,
    item.keySig,
    item.levelRaw,
    item.content,
    guideLabels,
    resourceValues
  ].join(' '));
}

function matchesSearch(item, term) {
  const normalizedTerm = normalizeText(term);

  if (!normalizedTerm) return true;

  const haystack = buildSearchHaystack(item);
  return haystack.includes(normalizedTerm);
}

function sortItems(items) {
  const sorted = [...items];

  sorted.sort((a, b) => {
    if (state.sort === 'name-asc') {
      return safeLocaleCompare(a.name, b.name);
    }

    if (state.sort === 'name-desc') {
      return safeLocaleCompare(b.name, a.name);
    }

    if (state.sort === 'level-asc') {
      return (a.levelNum - b.levelNum) || safeLocaleCompare(a.name, b.name);
    }

    if (state.sort === 'level-desc') {
      return (b.levelNum - a.levelNum) || safeLocaleCompare(a.name, b.name);
    }

    if (state.sort === 'genre-asc') {
      return safeLocaleCompare(a.genre || '', b.genre || '') || safeLocaleCompare(a.name, b.name);
    }

    return safeLocaleCompare(a.name, b.name);
  });

  return sorted;
}

function getFilteredItems() {
  const term = state.search.trim();

  let items = groups
    .filter((item) => item.levelNum >= state.levelMin)
    .filter((item) => matchesSearch(item, term));

  if (state.progressFilter === 'in-progress') {
    items = items.filter((item) => getProgressStatus(item.key) === PROGRESS.IN_PROGRESS);
  }

  if (state.progressFilter === 'done') {
    items = items.filter((item) => getProgressStatus(item.key) === PROGRESS.DONE);
  }

  if (state.progressFilter === 'favorites') {
    items = items.filter((item) => favorites.has(item.key));
  }

  return sortItems(items);
}

/* ==========================================================================
   LocalStorage
========================================================================== */

function parseJSON(value, fallback) {
  if (!value) return fallback;

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function loadState() {
  const guide = localStorage.getItem(LS.guide);
  const view = localStorage.getItem(LS.view);
  const sort = localStorage.getItem(LS.sort);
  const levelMin = localStorage.getItem(LS.levelMin);
  const progressFilter = localStorage.getItem(LS.progressFilter);

  if (guide) state.guide = guide;
  if (view === 'cards' || view === 'table') state.view = view;
  if (SORTS.has(sort)) state.sort = sort;
  if (levelMin !== null && !Number.isNaN(Number(levelMin))) {
    state.levelMin = clamp(Number(levelMin), 0, 5);
  }
  if (PROGRESS_FILTERS.has(progressFilter)) {
    state.progressFilter = progressFilter;
  }

  const storedProgress = parseJSON(localStorage.getItem(LS.progress), {});
  progress = {};

  for (const [songKey, rawStatus] of Object.entries(storedProgress || {})) {
    const status = rawStatus === 'doing'
      ? PROGRESS.IN_PROGRESS
      : rawStatus;

    if (status === PROGRESS.IN_PROGRESS || status === PROGRESS.DONE) {
      progress[songKey] = status;
    }
  }

  const storedFavorites = parseJSON(localStorage.getItem(LS.favorites), []);
  favorites = new Set(Array.isArray(storedFavorites) ? storedFavorites : []);

  const storedRecent = parseJSON(localStorage.getItem(LS.recent), []);
  recent = Array.isArray(storedRecent) ? storedRecent.slice(0, MAX_RECENT) : [];
}

function persistState() {
  localStorage.setItem(LS.guide, state.guide);
  localStorage.setItem(LS.view, state.view);
  localStorage.setItem(LS.sort, state.sort);
  localStorage.setItem(LS.levelMin, String(state.levelMin));
  localStorage.setItem(LS.progressFilter, state.progressFilter);

  localStorage.setItem(LS.progress, JSON.stringify(progress));
  localStorage.setItem(LS.favorites, JSON.stringify([...favorites]));
  localStorage.setItem(LS.recent, JSON.stringify(recent.slice(0, MAX_RECENT)));
}

/* ==========================================================================
   Estado visual
========================================================================== */

function setStatus(message = '') {
  dom.statusLabel.textContent = message;
}

function updateSearchClearButton() {
  const hasSearch = Boolean(state.search.trim());

  dom.clearBtn.hidden = !hasSearch;
  dom.clearBtn.classList.toggle('hidden', !hasSearch);
}

function setView(view) {
  state.view = view === 'table' ? 'table' : 'cards';

  const isCards = state.view === 'cards';

  dom.cardsView.classList.toggle('hidden', !isCards);
  dom.tableView.classList.toggle('hidden', isCards);

  dom.viewCardsBtn.classList.toggle('active', isCards);
  dom.viewTableBtn.classList.toggle('active', !isCards);

  dom.viewCardsBtn.setAttribute('aria-pressed', String(isCards));
  dom.viewTableBtn.setAttribute('aria-pressed', String(!isCards));
}

function setProgressFilter(filter) {
  state.progressFilter = PROGRESS_FILTERS.has(filter) ? filter : 'all';
  updateProgressFilterUI();
}

function updateProgressFilterUI() {
  const buttons = [
    dom.filterAllBtn,
    dom.filterInProgressBtn,
    dom.filterDoneBtn,
    dom.filterFavoritesBtn
  ];

  for (const button of buttons) {
    const filter = button.dataset.progressFilter || 'all';
    const isActive = filter === state.progressFilter;

    button.classList.toggle('active', isActive);
    button.setAttribute('aria-pressed', String(isActive));
  }
}

function refreshGuideSelect() {
  dom.guideSelect.innerHTML = '';

  for (const guide of guideDefs) {
    const option = document.createElement('option');
    option.value = guide.key;
    option.textContent = guide.label;
    dom.guideSelect.appendChild(option);
  }

  if (!guideDefs.some((guide) => guide.key === state.guide)) {
    state.guide = guideDefs[0]?.key || '';
  }

  dom.guideSelect.value = state.guide;
}

function syncControlsFromState() {
  dom.searchInput.value = state.search;
  dom.sortSelect.value = SORTS.has(state.sort) ? state.sort : 'name-asc';
  dom.levelMin.value = String(clamp(state.levelMin, 0, 5));

  if (guideDefs.length) {
    refreshGuideSelect();
  }

  setView(state.view);
  updateProgressFilterUI();
  updateSearchClearButton();
}

function updateMeta(visibleCount, totalCount) {
  const hasAnyFilter =
    Boolean(state.search.trim()) ||
    state.levelMin > 0 ||
    state.progressFilter !== 'all';

  dom.countPill.textContent = hasAnyFilter
    ? `${visibleCount} canciones encontradas`
    : `${totalCount} canciones disponibles`;

  const doneCount = groups.filter((item) => getProgressStatus(item.key) === PROGRESS.DONE).length;
  dom.progressPill.textContent = `Progreso: ${doneCount} / ${totalCount}`;

  if (state.search.trim()) {
    setStatus('Búsqueda activa');
  } else if (state.progressFilter === 'favorites') {
    setStatus('Favoritas');
  } else if (state.progressFilter === 'in-progress') {
    setStatus('En proceso');
  } else if (state.progressFilter === 'done') {
    setStatus('Logradas');
  } else {
    setStatus('');
  }
}

function setEmptyCards(show) {
  dom.emptyCards.classList.toggle('hidden', !show);
}

function setEmptyTable(show) {
  dom.emptyTable.classList.toggle('hidden', !show);
}

/* ==========================================================================
   Recientes y favoritos
========================================================================== */

function toggleFavorite(songKey) {
  if (!songKey) return;

  if (favorites.has(songKey)) {
    favorites.delete(songKey);
  } else {
    favorites.add(songKey);
  }
}

function addRecent(songKey) {
  if (!songKey) return;

  recent = [
    songKey,
    ...recent.filter((key) => key !== songKey)
  ].slice(0, MAX_RECENT);
}

function clearRecent() {
  recent = [];
  persistState();
  renderRecent();
}

function getItemByKey(songKey) {
  return groups.find((item) => item.key === songKey) || null;
}

/* ==========================================================================
   Modal
========================================================================== */

function openModal(item, guideKey = state.guide) {
  if (!item) return;

  const selectedGuideKey = guideKey || getBestGuideKey(item);
  const guide = getGuideByKey(selectedGuideKey);
  const guideLabel = guide ? guide.label : 'Recurso';
  const value = String(item.versions[selectedGuideKey] || '').trim();

  addRecent(item.key);
  persistState();
  renderRecent();

  const metaParts = [
    item.artist || 'Sin artista registrado',
    item.genre || 'Sin género',
    item.keySig ? `Tonalidad: ${item.keySig}` : 'Tonalidad: —',
    `Nivel: ${levelDisplay(item)}`,
    `Estado: ${progressLabel(getProgressStatus(item.key))}`
  ];

  dom.modalTitle.textContent = item.name;
  dom.modalMeta.textContent = metaParts.join(' · ');

  if (!value) {
    dom.modalContent.textContent = `Esta guía todavía no está disponible.\n\nGuía seleccionada: ${guideLabel}`;
    dom.modalAction.innerHTML = '';
  } else if (isLink(value)) {
    const contentText = [
      `Guía: ${guideLabel}`,
      '',
      'Este recurso se abrirá en una pestaña nueva.',
      item.content ? `\nNotas:\n${item.content}` : ''
    ].join('\n');

    dom.modalContent.textContent = contentText;

    dom.modalAction.innerHTML = `
      <a
        class="btnLink"
        href="${escapeHTML(value)}"
        target="_blank"
        rel="noopener noreferrer"
      >
        Abrir ${escapeHTML(guideLabel)}
      </a>
    `;
  } else {
    const contentText = [
      `Guía: ${guideLabel}`,
      '',
      value,
      item.content && item.content !== value ? `\nNotas:\n${item.content}` : ''
    ].join('\n');

    dom.modalContent.textContent = contentText;
    dom.modalAction.innerHTML = '';
  }

  dom.modalOverlay.classList.remove('hidden');
}

function closeModal() {
  dom.modalOverlay.classList.add('hidden');
}

/* ==========================================================================
   Render recientes
========================================================================== */

function renderRecent() {
  const shouldShow =
    recent.length > 0 &&
    !state.search.trim() &&
    state.progressFilter === 'all';

  if (!shouldShow) {
    dom.recentSection.classList.add('hidden');
    dom.recentList.innerHTML = '';
    return;
  }

  const recentItems = recent
    .map((songKey) => getItemByKey(songKey))
    .filter(Boolean);

  if (!recentItems.length) {
    dom.recentSection.classList.add('hidden');
    dom.recentList.innerHTML = '';
    return;
  }

  dom.recentSection.classList.remove('hidden');

  dom.recentList.innerHTML = recentItems
    .map((item) => {
      const status = getProgressStatus(item.key);

      return `
        <button
          class="recentBtn"
          type="button"
          data-recent-open="${escapeHTML(item.key)}"
          aria-label="Abrir ${escapeHTML(item.name)}"
        >
          <span class="recentBtn__title">${escapeHTML(item.name)}</span>
          <span class="recentBtn__meta">
            ${escapeHTML(item.artist || 'Sin artista')} · ${escapeHTML(progressLabel(status))}
          </span>
        </button>
      `;
    })
    .join('');
}

/* ==========================================================================
   Render tarjetas
========================================================================== */

function renderCards(items) {
  dom.cardsGrid.innerHTML = '';

  setEmptyCards(items.length === 0);

  if (!items.length) return;

  const html = items
    .map((item) => {
      const status = getProgressStatus(item.key);
      const bestGuideKey = getBestGuideKey(item);
      const bestGuideLabel = getCompactGuideLabel(bestGuideKey);
      const hasBestGuide = Boolean(String(item.versions[bestGuideKey] || '').trim());
      const isFavorite = favorites.has(item.key);
      const availableGuides = getAvailableGuides(item);

      const guideButtons = availableGuides
        .map((guide) => {
          const isSelected = guide.key === bestGuideKey;
          const classes = [
            'vbtn',
            isSelected ? 'on' : ''
          ].filter(Boolean).join(' ');

          return `
            <button
              class="${classes}"
              type="button"
              data-guide-open="${escapeHTML(guide.key)}"
              data-song="${escapeHTML(item.key)}"
              aria-label="Abrir ${escapeHTML(getCompactGuideLabel(guide.key))} de ${escapeHTML(item.name)}"
              title="Abrir recurso"
            >
              ${escapeHTML(getCompactGuideLabel(guide.key))}
            </button>
          `;
        })
        .join('');

      const contentPreview = item.content
        ? `
          <p class="card__subtitle">
            ${escapeHTML(item.content).slice(0, 150)}${item.content.length > 150 ? '…' : ''}
          </p>
        `
        : '';

      return `
        <article class="card" data-song-card="${escapeHTML(item.key)}">
          <div class="card__top">
            <div>
              <h4 class="card__title">${escapeHTML(item.name)}</h4>
              <p class="card__subtitle">
                ${escapeHTML(item.artist || 'Sin artista registrado')}
              </p>
            </div>

            <button
              class="favoriteBtn ${isFavorite ? 'active' : ''}"
              type="button"
              data-favorite="${escapeHTML(item.key)}"
              aria-pressed="${String(isFavorite)}"
              aria-label="${isFavorite ? 'Quitar de favoritos' : 'Agregar a favoritos'}"
              title="${isFavorite ? 'Quitar de favoritos' : 'Agregar a favoritos'}"
            >
              ${isFavorite ? '★' : '☆'}
            </button>
          </div>

          <div class="card__meta">
            <span class="badge">Género: ${escapeHTML(item.genre || '—')}</span>
            <span class="badge">Tonalidad: ${escapeHTML(item.keySig || '—')}</span>
            <span class="badge">Nivel: ${escapeHTML(levelDisplay(item))}</span>
            <span class="badge ${progressBadgeClass(status)}">${escapeHTML(progressLabel(status))}</span>
          </div>

          ${contentPreview}

          <div class="versions" aria-label="Recursos disponibles">
            ${guideButtons || '<small class="noResources">Sin recursos disponibles</small>'}
          </div>

          ${hasBestGuide ? `
          <div class="card__actions">
            <button
              class="primaryAction"
              type="button"
              data-open-primary="${escapeHTML(item.key)}"
              data-guide="${escapeHTML(bestGuideKey)}"
            >
              Abrir ${escapeHTML(bestGuideLabel)}
            </button>
          </div>
          ` : ''}

          <div class="progressRow" aria-label="Estado de práctica">
            <button
              class="pbtn ${status === PROGRESS.NONE ? 'active' : ''}"
              type="button"
              data-progress="${PROGRESS.NONE}"
              data-song="${escapeHTML(item.key)}"
              aria-pressed="${String(status === PROGRESS.NONE)}"
            >
              Sin iniciar
            </button>

            <button
              class="pbtn ${status === PROGRESS.IN_PROGRESS ? 'active' : ''}"
              type="button"
              data-progress="${PROGRESS.IN_PROGRESS}"
              data-song="${escapeHTML(item.key)}"
              aria-pressed="${String(status === PROGRESS.IN_PROGRESS)}"
            >
              En proceso
            </button>

            <button
              class="pbtn ${status === PROGRESS.DONE ? 'active' : ''}"
              type="button"
              data-progress="${PROGRESS.DONE}"
              data-song="${escapeHTML(item.key)}"
              aria-pressed="${String(status === PROGRESS.DONE)}"
            >
              Lograda
            </button>
          </div>
        </article>
      `;
    })
    .join('');

  dom.cardsGrid.innerHTML = html;
}

/* ==========================================================================
   Render tabla
========================================================================== */

function renderTable(items) {
  setEmptyTable(items.length === 0);

  dom.headerRow.innerHTML = '';
  dom.tableBody.innerHTML = '';

  const headers = [
    'Canción',
    'Artista',
    'Género',
    'Nivel',
    'Tonalidad',
    'Estado',
    'Favorita',
    getGuideLabel(state.guide)
  ];

  dom.headerRow.innerHTML = headers
    .map((header) => `<th>${escapeHTML(header)}</th>`)
    .join('');

  if (!items.length) return;

  dom.tableBody.innerHTML = items
    .map((item) => {
      const status = getProgressStatus(item.key);
      const selectedValue = String(item.versions[state.guide] || '').trim();
      const bestGuideKey = getBestGuideKey(item);
      const bestValue = String(item.versions[bestGuideKey] || '').trim();

      let resourceCell = '—';

      if (selectedValue && isLink(selectedValue)) {
        resourceCell = `
          <a href="${escapeHTML(selectedValue)}" target="_blank" rel="noopener noreferrer">
            Abrir
          </a>
        `;
      } else if (selectedValue) {
        resourceCell = `
          <button
            class="vbtn"
            type="button"
            data-table-open="${escapeHTML(item.key)}"
            data-guide="${escapeHTML(state.guide)}"
          >
            Ver texto
          </button>
        `;
      } else if (bestValue) {
        resourceCell = `
          <button
            class="vbtn"
            type="button"
            data-table-open="${escapeHTML(item.key)}"
            data-guide="${escapeHTML(bestGuideKey)}"
          >
            Abrir ${escapeHTML(getCompactGuideLabel(bestGuideKey))}
          </button>
        `;
      }

      return `
        <tr>
          <td>${escapeHTML(item.name)}</td>
          <td>${escapeHTML(item.artist || '—')}</td>
          <td>${escapeHTML(item.genre || '—')}</td>
          <td>${escapeHTML(levelDisplay(item))}</td>
          <td>${escapeHTML(item.keySig || '—')}</td>
          <td>${escapeHTML(progressLabel(status))}</td>
          <td>${favorites.has(item.key) ? '★' : '—'}</td>
          <td>${resourceCell}</td>
        </tr>
      `;
    })
    .join('');
}

/* ==========================================================================
   Render principal
========================================================================== */

function rerender() {
  persistState();
  syncControlsFromState();

  const items = getFilteredItems();

  updateMeta(items.length, groups.length);
  renderRecent();

  if (state.view === 'table') {
    renderTable(items);
  } else {
    renderCards(items);
  }
}

/* ==========================================================================
   Acciones de usuario
========================================================================== */

function resetFilters() {
  state.search = '';
  state.levelMin = 0;
  state.progressFilter = 'all';

  dom.searchInput.value = '';
  dom.levelMin.value = '0';

  rerender();
  dom.searchInput.focus();
}

function openFirstResultFromSearch() {
  const items = getFilteredItems();

  if (!items.length) return;

  const first = items[0];
  const guideKey = getBestGuideKey(first);

  openModal(first, guideKey);
}

function wireEvents() {
  dom.viewCardsBtn.addEventListener('click', () => {
    setView('cards');
    rerender();
  });

  dom.viewTableBtn.addEventListener('click', () => {
    setView('table');
    rerender();
  });

  dom.guideSelect.addEventListener('change', (event) => {
    state.guide = event.target.value;
    rerender();
  });

  dom.sortSelect.addEventListener('change', (event) => {
    state.sort = SORTS.has(event.target.value) ? event.target.value : 'name-asc';
    rerender();
  });

  dom.levelMin.addEventListener('change', (event) => {
    state.levelMin = clamp(Number(event.target.value || 0), 0, 5);
    rerender();
  });

  let searchTimer = null;

  dom.searchInput.addEventListener('input', (event) => {
    clearTimeout(searchTimer);

    state.search = event.target.value;
    updateSearchClearButton();

    searchTimer = setTimeout(() => {
      rerender();
    }, 110);
  });

  dom.searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      state.search = dom.searchInput.value;
      rerender();
      openFirstResultFromSearch();
    }

    if (event.key === 'Escape' && state.search.trim()) {
      event.preventDefault();
      state.search = '';
      dom.searchInput.value = '';
      rerender();
    }
  });

  dom.clearBtn.addEventListener('click', () => {
    state.search = '';
    dom.searchInput.value = '';
    rerender();
    dom.searchInput.focus();
  });

  const filterButtons = [
    dom.filterAllBtn,
    dom.filterInProgressBtn,
    dom.filterDoneBtn,
    dom.filterFavoritesBtn
  ];

  for (const button of filterButtons) {
    button.addEventListener('click', () => {
      setProgressFilter(button.dataset.progressFilter || 'all');
      rerender();
    });
  }

  dom.emptyResetBtn.addEventListener('click', resetFilters);
  dom.emptyTableResetBtn.addEventListener('click', resetFilters);

  dom.clearRecentBtn.addEventListener('click', clearRecent);

  dom.recentList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-recent-open]');
    if (!button) return;

    const item = getItemByKey(button.dataset.recentOpen);
    if (!item) return;

    openModal(item, getBestGuideKey(item));
  });

  dom.cardsGrid.addEventListener('click', (event) => {
    const favoriteButton = event.target.closest('[data-favorite]');
    if (favoriteButton) {
      toggleFavorite(favoriteButton.dataset.favorite);
      rerender();
      return;
    }

    const primaryButton = event.target.closest('[data-open-primary]');
    if (primaryButton && !primaryButton.disabled) {
      const item = getItemByKey(primaryButton.dataset.openPrimary);
      const guideKey = primaryButton.dataset.guide || getBestGuideKey(item);

      if (item) openModal(item, guideKey);
      return;
    }

    const guideButton = event.target.closest('[data-guide-open]');
    if (guideButton && !guideButton.disabled) {
      const item = getItemByKey(guideButton.dataset.song);
      const guideKey = guideButton.dataset.guideOpen;

      if (item) {
        state.guide = guideKey;
        openModal(item, guideKey);
        rerender();
      }

      return;
    }

    const progressButton = event.target.closest('[data-progress]');
    if (progressButton) {
      const songKey = progressButton.dataset.song;
      const nextStatus = progressButton.dataset.progress;

      setProgressStatus(songKey, nextStatus);
      rerender();
    }
  });

  dom.tableBody.addEventListener('click', (event) => {
    const button = event.target.closest('[data-table-open]');
    if (!button) return;

    const item = getItemByKey(button.dataset.tableOpen);
    const guideKey = button.dataset.guide;

    if (item) {
      openModal(item, guideKey);
    }
  });

  dom.modalClose.addEventListener('click', closeModal);

  dom.modalOverlay.addEventListener('click', (event) => {
    if (event.target === dom.modalOverlay) {
      closeModal();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !dom.modalOverlay.classList.contains('hidden')) {
      closeModal();
    }
  });
}

/* ==========================================================================
   Carga inicial
========================================================================== */

async function loadData() {
  setStatus('Cargando repertorio…');
  dom.countPill.textContent = 'Cargando…';
  dom.progressPill.textContent = 'Progreso: —';

  const response = await fetch(DATA_URL, {
    cache: 'no-store'
  });

  if (!response.ok) {
    throw new Error(`No se pudo cargar la hoja. HTTP ${response.status}`);
  }

  const text = await response.text();
  rows = validateRows(parseData(text));

  if (!rows.length) {
    throw new Error('La hoja no tiene datos.');
  }

  if (!rows[0] || rows[0].length < 1) {
    throw new Error('La hoja no tiene encabezados válidos.');
  }

  buildColumnMap(rows[0]);
  groups = groupSongs(rows.slice(1));

  if (!groups.length) {
    throw new Error('No se encontraron canciones válidas.');
  }
}

async function init() {
  try {
    loadState();
    wireEvents();
    syncControlsFromState();

    await loadData();

    refreshGuideSelect();
    setStatus('');
    rerender();
  } catch (error) {
    console.error(error);

    setStatus('No se pudo cargar el repertorio');
    dom.countPill.textContent = 'Error cargando datos';
    dom.progressPill.textContent = 'Progreso: —';

    dom.cardsGrid.innerHTML = '';
    dom.tableBody.innerHTML = '';

    dom.emptyCards.classList.remove('hidden');
    dom.emptyCards.querySelector('.empty__title').textContent = 'No se pudo cargar el repertorio';

    const emptyText = dom.emptyCards.querySelector('p');
    if (emptyText) {
      emptyText.textContent = 'Revisa que la hoja esté publicada correctamente y que el enlace TSV siga activo.';
    }
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
