console.debug('[llo-tracker] sidepanel.js loaded');

// ── Constants ─────────────────────────────────────────────────────────────────

const VERSION = '2.1.0';
const LEVEL_ORDER = ['A1', 'A2', 'B1', 'B2'];
const DEFAULT_SETTINGS = { showInPageBadges: true };

// ── Storage helpers ───────────────────────────────────────────────────────────

async function loadAllRecords() {
  const all = await chrome.storage.local.get(null);
  const records = {};
  for (const [k, v] of Object.entries(all)) {
    if (k.startsWith('activity:')) records[k] = v;
  }
  return records;
}

async function loadSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...(settings ?? {}) };
}

async function saveSettings(next) {
  await chrome.storage.local.set({ settings: next });
}

// ── State ─────────────────────────────────────────────────────────────────────

let state = {
  records:      {},
  settings:     { ...DEFAULT_SETTINGS },
  selectedLevel: null,
  expandedThemes: new Set(),
};

// ── Grouping helpers ──────────────────────────────────────────────────────────

function groupRecords(records) {
  // levels → themes → activities
  const grouped = {};
  for (const rec of Object.values(records)) {
    const level = rec.level || '??';
    const theme = rec.theme || '??';
    if (!grouped[level]) grouped[level] = {};
    if (!grouped[level][theme]) grouped[level][theme] = [];
    grouped[level][theme].push(rec);
  }
  // Sort within each theme by lessonName + activityName
  for (const level of Object.keys(grouped)) {
    for (const theme of Object.keys(grouped[level])) {
      grouped[level][theme].sort((a, b) => {
        const ln = (a.lessonName ?? '').localeCompare(b.lessonName ?? '');
        if (ln !== 0) return ln;
        return (a.activityName ?? '').localeCompare(b.activityName ?? '');
      });
    }
  }
  return grouped;
}

function sortedLevels(grouped) {
  const levels = Object.keys(grouped);
  return levels.sort((a, b) => {
    const ia = LEVEL_ORDER.indexOf(a);
    const ib = LEVEL_ORDER.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
}

function defaultLevel(grouped) {
  const levels = sortedLevels(grouped);
  if (levels.length === 0) return null;
  let best = levels[0];
  let bestCount = 0;
  for (const level of levels) {
    let count = 0;
    for (const theme of Object.keys(grouped[level])) {
      count += grouped[level][theme].length;
    }
    if (count > bestCount) { bestCount = count; best = level; }
  }
  return best;
}

// ── Render ────────────────────────────────────────────────────────────────────

function formatDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
    });
  } catch {
    return iso;
  }
}

function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (k === 'className') node.className = v;
    else if (k === 'textContent') node.textContent = v;
    else if (k === 'title') node.title = v;
    else node.setAttribute(k, v);
  }
  for (const child of children) {
    if (child == null) continue;
    if (typeof child === 'string') node.appendChild(document.createTextNode(child));
    else node.appendChild(child);
  }
  return node;
}

function fmtScore(score, total) {
  if (total === 100) return `${score}%`;
  return `${score}/${total} ${Math.round((score / total) * 100)}%`;
}

function buildActivityRow(rec) {
  let icon, rightText, cls;
  if (rec.kind === 'viewed') {
    icon      = '📖';
    rightText = `v×${rec.viewCount}`;
    cls       = 'sp-row-viewed';
  } else {
    const attempts = rec.attempts > 1 ? ` (×${rec.attempts})` : '';
    icon = rec.passed ? '✅' : '⚠️';
    cls  = rec.passed ? 'sp-row-passed' : 'sp-row-failed';

    const bestStr = fmtScore(rec.bestScore, rec.bestTotal);
    const hasDiffLast = rec.lastScore != null && rec.lastTotal != null &&
      (rec.lastScore !== rec.bestScore || rec.lastTotal !== rec.bestTotal);
    if (hasDiffLast) {
      const lastStr = fmtScore(rec.lastScore, rec.lastTotal);
      rightText = `${bestStr} best / ${lastStr} last${attempts}`;
    } else {
      rightText = `${bestStr}${attempts}`;
    }
  }

  const nameText = rec.activityName || rec.activityCode;
  const dateText = rec.kind === 'viewed'
    ? (rec.lastViewed   ? formatDate(rec.lastViewed)   : '')
    : (rec.lastCompleted ? formatDate(rec.lastCompleted) : '');

  return el('div', { className: 'sp-activity-row ' + cls },
    el('span', { className: 'sp-row-icon', textContent: icon }),
    el('span', { className: 'sp-row-name', textContent: nameText, title: nameText }),
    el('span', { className: 'sp-row-right' },
      el('span', { className: 'sp-row-score', textContent: rightText }),
      dateText ? el('span', { className: 'sp-row-date', textContent: dateText }) : null,
    ),
  );
}

function buildThemeSection(theme, activities, expanded) {
  const scored  = activities.filter((r) => r.kind === 'scored');
  const passed  = scored.filter((r) => r.passed);
  const viewed  = activities.filter((r) => r.kind === 'viewed');

  const summary = `${scored.length}s / ${viewed.length}v`;
  const section = el('div', { className: 'sp-theme' });

  const header = el('div', { className: 'sp-theme-header' + (expanded ? ' sp-expanded' : '') });
  header.appendChild(el('span', { className: 'sp-theme-arrow', textContent: expanded ? '▼' : '▶' }));
  header.appendChild(el('span', { className: 'sp-theme-name', textContent: theme }));
  header.appendChild(el('span', { className: 'sp-theme-summary', textContent: summary }));

  section.appendChild(header);

  const body = el('div', { className: 'sp-theme-body' });
  if (expanded) {
    for (const act of activities) body.appendChild(buildActivityRow(act));
  } else {
    body.style.display = 'none';
  }
  section.appendChild(body);

  header.addEventListener('click', () => {
    const isNowExpanded = !state.expandedThemes.has(theme);
    if (isNowExpanded) state.expandedThemes.add(theme);
    else state.expandedThemes.delete(theme);
    render(state);
  });

  return section;
}

function render(s) {
  const main = document.getElementById('sp-main');
  const grouped = groupRecords(s.records);
  const levels  = sortedLevels(grouped);

  if (levels.length === 0) {
    main.replaceChildren(
      el('p', { className: 'sp-empty', textContent:
        'No records yet — start an exercise on llo.lu and your progress will show up here.' })
    );
    return;
  }

  const selectedLevel = s.selectedLevel ?? defaultLevel(grouped);

  const tree = el('div', { className: 'sp-tree' });

  // Level tabs
  const tabs = el('div', { className: 'sp-level-tabs' });
  for (const level of levels) {
    const btn = el('button', {
      className: 'sp-level-tab' + (level === selectedLevel ? ' sp-active' : ''),
      textContent: level,
    });
    btn.addEventListener('click', () => {
      state.selectedLevel = level;
      render(state);
    });
    tabs.appendChild(btn);
  }
  tree.appendChild(tabs);

  // Level summary
  if (selectedLevel && grouped[selectedLevel]) {
    const themes = grouped[selectedLevel];
    let totalScored = 0, totalViewed = 0;
    for (const acts of Object.values(themes)) {
      totalScored += acts.filter((r) => r.kind === 'scored').length;
      totalViewed += acts.filter((r) => r.kind === 'viewed').length;
    }
    tree.appendChild(
      el('p', { className: 'sp-level-summary',
        textContent: `${selectedLevel} — ${totalScored} scored, ${totalViewed} viewed` })
    );

    // Theme rows
    const sortedThemes = Object.keys(themes).sort();
    for (const theme of sortedThemes) {
      const expanded = s.expandedThemes.has(theme);
      tree.appendChild(buildThemeSection(theme, themes[theme], expanded));
    }
  }

  main.replaceChildren(tree);

  // Sync badge toggle
  const toggle = document.getElementById('sp-badges-toggle');
  if (toggle) toggle.checked = s.settings.showInPageBadges;
}

// ── Export ────────────────────────────────────────────────────────────────────

function exportJSON() {
  const date = new Date().toISOString().slice(0, 10);
  const payload = {
    exportedAt: new Date().toISOString(),
    version:    VERSION,
    settings:   state.settings,
    activities: state.records,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `llo-progress-${date}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ── Reset flow ────────────────────────────────────────────────────────────────

function showResetConfirm() {
  const actions = document.getElementById('sp-actions');
  actions.replaceChildren(
    el('span', { className: 'sp-confirm-text', textContent: 'Are you sure?' }),
    (() => {
      const cancel = el('button', { textContent: 'Cancel' });
      cancel.addEventListener('click', () => resetActionsToDefault());
      return cancel;
    })(),
    (() => {
      const confirm = el('button', { className: 'sp-reset', textContent: 'Yes, delete all' });
      confirm.addEventListener('click', async () => {
        await chrome.storage.local.clear();
        state.records   = {};
        state.settings  = { ...DEFAULT_SETTINGS };
        state.expandedThemes.clear();
        state.selectedLevel = null;
        resetActionsToDefault();
        render(state);
      });
      return confirm;
    })(),
  );
}

function resetActionsToDefault() {
  const actions = document.getElementById('sp-actions');
  const exportBtn = el('button', { textContent: 'Export JSON' });
  exportBtn.id = 'sp-export';
  exportBtn.addEventListener('click', exportJSON);

  const resetBtn = el('button', { className: 'sp-reset', textContent: 'Reset Data' });
  resetBtn.id = 'sp-reset';
  resetBtn.addEventListener('click', showResetConfirm);

  actions.replaceChildren(exportBtn, resetBtn);
}

// ── Storage listener ──────────────────────────────────────────────────────────

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local') return;
  if ('settings' in changes) {
    state.settings = changes.settings.newValue ?? { ...DEFAULT_SETTINGS };
  }
  // Reload all records on any activity change
  state.records = await loadAllRecords();
  render(state);
});

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  const [records, settings] = await Promise.all([loadAllRecords(), loadSettings()]);
  state.records  = records;
  state.settings = settings;
  render(state);

  document.getElementById('sp-badges-toggle').addEventListener('change', async (e) => {
    state.settings = { ...state.settings, showInPageBadges: e.target.checked };
    await saveSettings(state.settings);
  });

  document.getElementById('sp-export').addEventListener('click', exportJSON);
  document.getElementById('sp-reset').addEventListener('click', showResetConfirm);
}

init();
