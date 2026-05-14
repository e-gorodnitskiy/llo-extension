console.debug('[llo-tracker] content.js loaded');

// ── URL filters ──────────────────────────────────────────────────────────────

const ACTIVITY_PATH_RE =
  /^\/(?:(?<lang>de|en|lb)\/)?learn\/lessons\/(?<lesson>[^/]+)\/(?<activity>[^/]+)\/?$/;

const LESSON_PATH_RE =
  /^\/(?:(?<lang>de|en|lb)\/)?learn\/lessons\/(?<lesson>[^/]+)\/?$/;

const LESSONS_INDEX_RE =
  /^\/(?:(?<lang>de|en|lb)\/)?learn\/lessons\/?$/;

// Matches /learn/{theme}/{level} pages (e.g. /en/learn/PROGRESS_IN_THE_LANGUAGE_LB_LU/A1)
const LEVEL_PATH_RE =
  /^\/(?:(?<lang>de|en|lb)\/)?learn\/(?!lessons(?:\/|$))(?<theme>[^/]+)\/(?<level>[^/]+)\/?$/;

function isActivityPath(p) { return ACTIVITY_PATH_RE.test(p); }
function isLessonPath(p)   { return LESSON_PATH_RE.test(p); }
function isLessonsIndex(p) { return LESSONS_INDEX_RE.test(p); }
function isLevelPath(p)    { return LEVEL_PATH_RE.test(p); }

// Extract fields from the URL (used when data-page is stale)
function activityCodeFromPath(p) {
  return p.match(ACTIVITY_PATH_RE)?.groups?.activity ?? null;
}
function lessonCodeFromPath(p) {
  return p.match(ACTIVITY_PATH_RE)?.groups?.lesson ?? null;
}
function localeFromPath(p) {
  return p.match(ACTIVITY_PATH_RE)?.groups?.lang ?? 'fr';
}

// ── Activity classification ───────────────────────────────────────────────────

const SCORED_TYPES = new Set([
  'DRAG_AND_DROP', 'MULTIPLE_CHOICE', 'OPEN', 'LINKS',
  'CROSS_WORDS', 'WORD_SEARCH', 'FIND_TIME', 'WRITE_TIME',
  'RIGHT_FALSE', 'SPELLING', 'SUMMARY_TEST',
]);

const VIEWED_TYPES = new Set([
  'GRAMMAR_RULE', 'VOCABULARY_LIST', 'VIDEO', 'FLASH_CARDS',
]);

function classify(type) {
  if (SCORED_TYPES.has(type)) return 'scored';
  return 'viewed';
}

// Fallback when data-page type is unavailable: infer from activity code tokens.
// Returns 'viewed', 'scored', or null (unknown).
function classifyFromCode(code) {
  if (!code) return null;
  const upper = code.toUpperCase();
  for (const vt of VIEWED_TYPES) {
    if (upper.includes(vt.replace(/_/g, '_'))) return 'viewed';
  }
  // Common exercise keywords in activity codes
  if (/EXERCISE|EXERCICE|QUIZ|SPELLING|FIND_TIME|WRITE_TIME|SUMMARY_TEST/.test(upper)) return 'scored';
  return null;
}

// ── Page props ────────────────────────────────────────────────────────────────

function readPageProps() {
  const el = document.getElementById('app');
  if (!el || !el.dataset.page) return null;
  try { return JSON.parse(el.dataset.page); } catch { return null; }
}

function parseCode(code) {
  const m = code.match(/^([A-Z]{2})_([A-Z]{2})_(.+)$/);
  if (!m) return null;
  const [, cl, cr, rest] = m;
  const tokens = rest.split('_');
  if (tokens.length < 3) return null;
  const [level, theme, ...tail] = tokens;
  return { contentLang: cl + '_' + cr, level, theme, lessonName: tail.join('_') };
}

// ── Context guard ─────────────────────────────────────────────────────────────

function isContextValid() {
  try { return !!chrome.runtime?.id; } catch { return false; }
}

// ── Settings ──────────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS = { showInPageBadges: true };

async function loadSettings() {
  if (!isContextValid()) return { ...DEFAULT_SETTINGS };
  const { settings } = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...(settings ?? {}) };
}

// ── Storage ───────────────────────────────────────────────────────────────────

async function loadAllRecords() {
  if (!isContextValid()) return {};
  const all = await chrome.storage.local.get(null);
  const records = {};
  for (const [k, v] of Object.entries(all)) {
    if (k.startsWith('activity:')) records[k] = v;
  }
  return records;
}

async function loadLessonCache() {
  if (!isContextValid()) return {};
  const all = await chrome.storage.local.get(null);
  const cache = {};
  for (const [k, v] of Object.entries(all)) {
    if (k.startsWith('lesson:')) cache[k] = v;
  }
  return cache;
}

async function cacheLessonData(path) {
  if (!isContextValid()) return;
  const pd     = readPageProps();
  const lesson = pd?.props?.lesson;
  if (!lesson?.code || !lesson?.activities?.length) return;
  const key = 'lesson:' + lesson.code;
  await chrome.storage.local.set({
    [key]: {
      lessonCode: lesson.code,
      lessonName: lesson.name ?? '',
      activities: lesson.activities.map((a) => ({ code: a.code, type: a.type ?? '', name: a.name ?? '' })),
      cachedAt:   new Date().toISOString(),
    },
  });
  console.log('[llo-tracker] cached lesson', lesson.code, lesson.activities.length, 'activities');
}

// Build a record from URL + whatever data-page has at save time.
// data-page may still be stale; URL is always reliable for code/lesson/locale.
async function saveScore(path, score, total) {
  if (!isContextValid()) return;
  const pd       = readPageProps();
  const activity = pd?.props?.activity;
  const lesson   = pd?.props?.lesson;

  const code       = activity?.code       ?? activityCodeFromPath(path);
  const lessonCode = activity?.lesson_code ?? lessonCodeFromPath(path) ?? lesson?.code ?? '';
  if (!code) return;

  const key    = 'activity:' + code;
  const parsed = parseCode(code) ?? {};
  const now    = new Date().toISOString();
  const locale = pd?.props?.locale ?? localeFromPath(path);

  const { [key]: existing } = await chrome.storage.local.get(key);

  if (existing?.kind === 'scored') {
    const better = score / total > existing.bestScore / existing.bestTotal;
    await chrome.storage.local.set({
      [key]: {
        ...existing,
        bestScore:     better ? score : existing.bestScore,
        bestTotal:     better ? total : existing.bestTotal,
        lastScore:     score,
        lastTotal:     total,
        passed:        existing.passed || (score / total >= PASS_THRESHOLD),
        attempts:      existing.attempts + 1,
        lastCompleted: now,
        uiLang:        locale || existing.uiLang,
      },
    });
  } else {
    await chrome.storage.local.set({
      [key]: {
        kind:           'scored',
        activityCode:   code,
        lessonCode,
        activityType:   activity?.type  ?? '',
        activityName:   activity?.name  ?? '',
        lessonName:     lesson?.name    ?? '',
        level:          parsed.level    ?? '',
        theme:          parsed.theme    ?? '',
        uiLang:         locale,
        bestScore:      score,
        bestTotal:      total,
        lastScore:      score,
        lastTotal:      total,
        attempts:       1,
        firstCompleted: now,
        lastCompleted:  now,
        passed:         score / total >= PASS_THRESHOLD,
      },
    });
  }
}

async function saveViewed(path) {
  if (!isContextValid()) return;
  const pd       = readPageProps();
  const activity = pd?.props?.activity;
  const lesson   = pd?.props?.lesson;

  const code       = activity?.code       ?? activityCodeFromPath(path);
  const lessonCode = activity?.lesson_code ?? lessonCodeFromPath(path) ?? lesson?.code ?? '';
  if (!code) return;

  const key    = 'activity:' + code;
  const parsed = parseCode(code) ?? {};
  const now    = new Date().toISOString();
  const locale = pd?.props?.locale ?? localeFromPath(path);

  const { [key]: existing } = await chrome.storage.local.get(key);
  if (existing?.kind === 'scored') return; // never downgrade

  if (existing?.kind === 'viewed') {
    await chrome.storage.local.set({
      [key]: {
        ...existing,
        viewCount:  existing.viewCount + 1,
        lastViewed: now,
        uiLang:     locale || existing.uiLang,
      },
    });
  } else {
    await chrome.storage.local.set({
      [key]: {
        kind:         'viewed',
        activityCode: code,
        lessonCode,
        activityType: activity?.type ?? '',
        activityName: activity?.name ?? '',
        lessonName:   lesson?.name   ?? '',
        level:        parsed.level   ?? '',
        theme:        parsed.theme   ?? '',
        uiLang:       locale,
        viewCount:    1,
        firstViewed:  now,
        lastViewed:   now,
      },
    });
  }
}

// ── Module state ──────────────────────────────────────────────────────────────

const PASS_THRESHOLD  = 0.7;
const STABILITY_MS    = 800;
const VIEWED_DWELL_MS = 5000;

let scoreObserver   = null;
let pageObserver    = null;
let stabilityTimer  = null;
let viewedTimer     = null;
let lastSeenText    = null;
let currentCapturePath = null; // path for which capture was started
const savedThisLoad = new Set();

let settings = { showInPageBadges: true };

// ── Tear-down ─────────────────────────────────────────────────────────────────

function teardown() {
  scoreObserver?.disconnect(); scoreObserver = null;
  clearTimeout(stabilityTimer); stabilityTimer = null;
  clearTimeout(viewedTimer);    viewedTimer    = null;
  lastSeenText       = null;
  currentCapturePath = null;
  savedThisLoad.clear();
  removeAllBadges();
}

// ── Score capture ─────────────────────────────────────────────────────────────

function startScoreObserver(path) {
  console.log('[llo-tracker] startScoreObserver', path);
  scoreObserver = new MutationObserver(() => checkForResult(path));
  scoreObserver.observe(document.body, { childList: true, subtree: true });
  checkForResult(path);
}

function checkForResult(path) {
  // Guard: skip known theory activities so percentage text in theory content
  // (e.g. "80% of sentences") is not mistaken for an exercise score.
  const activity = readPageProps()?.props?.activity;
  const type     = activity?.type;
  if (type && !SCORED_TYPES.has(type)) return;
  const code = activity?.code ?? activityCodeFromPath(path);
  if (!type && classifyFromCode(code) === 'viewed') return;

  // The result screen shows the score as a percentage in <main> text content.
  // CircularProgressbar widgets show the "questions answered" count (e.g. "6/6"),
  // NOT the actual score (e.g. "83%"), so we read from textContent instead.
  const mainText = document.querySelector('main')?.textContent ?? '';
  const m = mainText.match(/\b(\d+(?:\.\d+)?)\s*%/);
  if (!m) return;

  const pct = parseFloat(m[1]);
  if (pct < 0 || pct > 100) return;

  const canonText = `${Math.round(pct)}%`;
  if (canonText === lastSeenText) return;

  lastSeenText = canonText;
  console.log('[llo-tracker] score candidate', canonText, '→ waiting', STABILITY_MS, 'ms');
  clearTimeout(stabilityTimer);
  stabilityTimer = setTimeout(() => commitScore(path, Math.round(pct), 100), STABILITY_MS);
}

function commitScore(path, score, total) {
  // Read activity code from data-page if available; fall back to URL.
  const code = readPageProps()?.props?.activity?.code ?? activityCodeFromPath(path);
  console.log('[llo-tracker] commitScore', code, score, '/', total);
  if (!code) return;
  if (savedThisLoad.has(code)) return;
  savedThisLoad.add(code);
  // Cancel dwell — score wins
  clearTimeout(viewedTimer); viewedTimer = null;
  saveScore(path, score, total).catch((e) => console.error('[llo-tracker] saveScore failed', e));
  scoreObserver?.disconnect(); scoreObserver = null;
}

// ── Theory dwell capture ──────────────────────────────────────────────────────

function startDwell(path) {
  console.log('[llo-tracker] startDwell', path);
  viewedTimer = setTimeout(() => commitViewed(path), VIEWED_DWELL_MS);
}

function commitViewed(path) {
  // By 5 s, data-page should be updated; but also check via code if not.
  const pd       = readPageProps();
  const activity = pd?.props?.activity;
  const type     = activity?.type;
  const code     = activity?.code ?? activityCodeFromPath(path);
  console.log('[llo-tracker] commitViewed check', code, type);

  // Don't save as viewed if this is clearly a scored exercise
  if (type && SCORED_TYPES.has(type)) { console.log('[llo-tracker] commitViewed blocked: scored type', type); return; }
  if (!type && classifyFromCode(code) === 'scored') { console.log('[llo-tracker] commitViewed blocked: code looks scored', code); return; }

  if (!code) return;
  if (savedThisLoad.has(code)) return;
  savedThisLoad.add(code);
  console.log('[llo-tracker] commitViewed saving', code);
  saveViewed(path).catch((e) => console.error('[llo-tracker] saveViewed failed', e));
}

// ── In-page badges ────────────────────────────────────────────────────────────

function removeAllBadges() {
  document.querySelectorAll('.llo-tracker-badge, .llo-tracker-level-banner').forEach((b) => b.remove());
}

function makeBadge(cls, text, title) {
  const span = document.createElement('span');
  span.className = 'llo-tracker-badge ' + cls;
  span.textContent = text;
  span.title = title;
  return span;
}

function fmtScore(score, total) {
  if (total === 100) return `${score}%`;
  return `${score}/${total} ${Math.round((score / total) * 100)}%`;
}

function buildActivityBadge(record) {
  if (record.kind === 'viewed') {
    return makeBadge('llo-tracker-viewed', `📖 ×${record.viewCount}`, 'LLO Tracker: viewed');
  }
  const attempts = record.attempts > 1 ? ` (×${record.attempts})` : '';
  const text     = `${record.passed ? '✓' : '⚠'} ${fmtScore(record.bestScore, record.bestTotal)}${attempts}`;
  const cls      = record.passed ? 'llo-tracker-passed' : 'llo-tracker-failed';
  return makeBadge(cls, text, 'LLO Tracker: exercise result');
}

function injectActivityCardBadges(records) {
  for (const link of document.querySelectorAll('a[href]')) {
    const m = link.pathname.match(ACTIVITY_PATH_RE);
    if (!m) continue;
    const actCode = m.groups?.activity;
    if (!actCode) continue;
    const record = records['activity:' + actCode];
    if (!record) continue;
    if (!link.querySelector('.llo-tracker-badge')) link.appendChild(buildActivityBadge(record));
  }
}

function injectLessonSummaryBadges(records, lessonCache) {
  for (const link of document.querySelectorAll('a[href]')) {
    const m = link.pathname.match(LESSON_PATH_RE);
    if (!m) continue;
    const lessonCode = m.groups?.lesson;
    if (!lessonCode) continue;

    const recs   = Object.values(records).filter((r) => r.lessonCode === lessonCode);
    const cached = lessonCache?.['lesson:' + lessonCode];

    let text, cls;

    if (cached?.activities?.length) {
      // We know the real total — show done/total with checkmark when complete
      const total = cached.activities.length;
      const done  = cached.activities.filter((a) => records['activity:' + a.code]).length;
      if (done === 0) { link.querySelector('.llo-tracker-badge')?.remove(); continue; }
      const allDone = done === total;
      text = allDone ? `✓ ${done}/${total}` : `${done}/${total}`;
      cls  = allDone ? 'llo-tracker-summary llo-tracker-passed' : 'llo-tracker-summary';
    } else {
      // No cache yet — fall back to counting what we've recorded
      if (recs.length === 0) { link.querySelector('.llo-tracker-badge')?.remove(); continue; }
      const scored = recs.filter((r) => r.kind === 'scored');
      const passed = scored.filter((r) => r.passed);
      const viewed = recs.filter((r) => r.kind === 'viewed');
      if (scored.length > 0) {
        text = passed.length === scored.length ? `✓ ${passed.length}` : `${passed.length}/${scored.length}`;
        cls  = passed.length === scored.length ? 'llo-tracker-summary llo-tracker-passed' : 'llo-tracker-summary';
      } else {
        text = `📖 ×${viewed.length}`;
        cls  = 'llo-tracker-summary llo-tracker-viewed';
      }
    }

    // Lesson cards use overflow:hidden + fixed height, so position the badge
    // absolutely in the bottom-right corner rather than appending to flow.
    const badge = makeBadge(cls + ' llo-tracker-badge-card', text, 'LLO Tracker: lesson progress');
    const existing = link.querySelector('.llo-tracker-badge');
    if (existing) {
      if (existing.textContent === badge.textContent) continue;
      existing.replaceWith(badge);
    } else {
      link.appendChild(badge);
    }
  }
}

function injectLevelSummaryBadge(records) {
  const props = readPageProps()?.props;
  const level = props?.level?.code ?? null;
  if (!level) return;

  document.querySelector('.llo-tracker-level-banner')?.remove();

  // Total lessons in this level from Inertia props (accurate denominator)
  const levelMissions = (props?.missions ?? []).filter((m) => m.level?.code === level);
  const allLessons = levelMissions.flatMap((m) => m.lessons ?? []);
  const totalLessons = allLessons.length;

  // Lessons with any stored record
  const touchedCodes = new Set(Object.values(records).map((r) => r.lessonCode).filter(Boolean));
  const touchedCount = allLessons.filter((l) => touchedCodes.has(l.code)).length;

  if (touchedCount === 0) return;

  // Exercise stats (counts only — avoid misleading fractions)
  const levelRecs = Object.values(records).filter((r) => r.level === level);
  const passed    = levelRecs.filter((r) => r.kind === 'scored' && r.passed);

  let text = `${level}: ${touchedCount}/${totalLessons} lessons started`;
  if (passed.length > 0) text += `, ${passed.length} exercise${passed.length > 1 ? 's' : ''} passed`;

  const banner = document.createElement('div');
  banner.className = 'llo-tracker-level-banner';
  banner.textContent = text;
  banner.title = 'LLO Tracker: level progress';

  const main = document.querySelector('main');
  if (!main) return;
  main.insertBefore(banner, main.firstChild);
}

function injectMissionBadges(records, lessonCache) {
  const props = readPageProps()?.props;
  const level = props?.level?.code ?? null;
  if (!level) return;

  const levelMissions = (props?.missions ?? []).filter((m) => m.level?.code === level);
  if (levelMissions.length === 0) return;

  // Accordion triggers are button[aria-expanded] without aria-haspopup.
  // Dropdown triggers have aria-haspopup="menu", so :not([aria-haspopup]) excludes them.
  const triggers = Array.from(document.querySelectorAll('button[aria-expanded]:not([aria-haspopup])'));
  if (!triggers.length) return;

  for (const mission of levelMissions) {
    const lessons = mission.lessons ?? [];
    const total = lessons.length;
    if (total === 0) continue;

    // "done"    = lesson has cache entry AND all its activities are recorded
    // "started" = lesson has any record but is not fully done
    let lessonsDone = 0;
    let lessonsStarted = 0;
    for (const l of lessons) {
      const hasAny = Object.values(records).some((r) => r.lessonCode === l.code);
      if (!hasAny) continue;
      const cached = lessonCache?.['lesson:' + l.code];
      if (cached?.activities?.length && cached.activities.every((a) => records['activity:' + a.code])) {
        lessonsDone++;
      } else {
        lessonsStarted++;
      }
    }

    // Find the accordion trigger by matching mission name in button text content
    const trigger = triggers.find((btn) => {
      const clone = btn.cloneNode(true);
      clone.querySelectorAll('.llo-tracker-badge').forEach((b) => b.remove());
      return clone.textContent.includes(mission.name);
    });
    if (!trigger) continue;

    if (lessonsDone === 0 && lessonsStarted === 0) { trigger.querySelector('.llo-tracker-badge')?.remove(); continue; }

    let text, cls;
    if (lessonsDone === total) {
      text = `✓ ${total} lessons`;
      cls  = 'llo-tracker-summary llo-tracker-passed';
    } else if (lessonsDone > 0 && lessonsStarted > 0) {
      text = `${lessonsDone} done, ${lessonsStarted} started`;
      cls  = 'llo-tracker-summary';
    } else if (lessonsDone > 0) {
      text = `${lessonsDone}/${total} done`;
      cls  = 'llo-tracker-summary';
    } else {
      text = `${lessonsStarted}/${total} started`;
      cls  = 'llo-tracker-summary';
    }
    const badge = makeBadge(cls, text, 'LLO Tracker: mission progress');

    const existing = trigger.querySelector('.llo-tracker-badge');
    if (existing) {
      if (existing.textContent === badge.textContent) continue;
      existing.replaceWith(badge);
    } else {
      trigger.appendChild(badge);
    }
  }
}

function injectActivityHeaderBadge(records) {
  const code = readPageProps()?.props?.activity?.code ?? activityCodeFromPath(location.pathname);
  if (!code) return;
  const record = records['activity:' + code];
  const header = document.querySelector('header') ?? document.querySelector('main');
  if (!header) return;
  const existing = header.querySelector('.llo-tracker-badge');
  if (!record) { existing?.remove(); return; }
  const badge = buildActivityBadge(record);
  if (existing) {
    if (existing.textContent === badge.textContent) return;
    existing.replaceWith(badge);
  } else {
    header.appendChild(badge);
  }
}

// Debounced MutationObserver on <main> to re-badge after llo.lu adds links
let badgeDebounceTimer = null;
let mainBadgeObserver  = null;
let badgeRefreshing    = false;

function startMainObserver() {
  mainBadgeObserver?.disconnect();
  const main = document.querySelector('main');
  if (!main) return;
  mainBadgeObserver = new MutationObserver(() => {
    if (badgeRefreshing) return;
    clearTimeout(badgeDebounceTimer);
    badgeDebounceTimer = setTimeout(() => refreshBadges(), 250);
  });
  mainBadgeObserver.observe(main, { childList: true, subtree: true });
}

async function refreshBadges() {
  badgeRefreshing = true;
  try {
    if (!settings.showInPageBadges) return;
    const [records, lessonCache] = await Promise.all([loadAllRecords(), loadLessonCache()]);
    const path = location.pathname;
    if (isActivityPath(path)) {
      injectActivityHeaderBadge(records);
    } else {
      injectActivityCardBadges(records);
      injectLessonSummaryBadges(records, lessonCache);
      if (isLevelPath(path)) {
        injectLevelSummaryBadge(records);
        injectMissionBadges(records, lessonCache);
      }
    }
  } finally {
    badgeRefreshing = false;
  }
}

// ── data-page observer ────────────────────────────────────────────────────────

function startPageObserver() {
  const el = document.getElementById('app');
  if (!el) return;
  pageObserver = new MutationObserver(onNavigate);
  pageObserver.observe(el, { attributes: true, attributeFilter: ['data-page'] });
}

// ── Navigation handler ────────────────────────────────────────────────────────

function onNavigate() {
  const path = location.pathname;

  if (path !== currentCapturePath) {
    // Genuine navigation to a new URL — full reset.
    teardown();                 // sets currentCapturePath = null
    currentCapturePath = path;
    console.log('[llo-tracker] onNavigate', path);

    if (isActivityPath(path)) {
      // Start both; commitScore cancels the dwell timer if a result appears first.
      // commitViewed checks the activity type at fire time (5 s later) to avoid
      // recording a scored exercise as "viewed" when the user doesn't finish.
      startScoreObserver(path);
      startDwell(path);
    }
  } else {
    // Inertia made a partial data-page update at the same URL (happens 2-3× per
    // navigation). Do NOT reset the dwell/stability timers — just refresh badges.
    console.log('[llo-tracker] onNavigate (data-page update, same path)', path);
  }

  // Cache lesson activity list whenever we're on a lesson page and data-page updates.
  // Called in both branches so later data-page updates (with fresh props) are also captured.
  if (isLessonPath(path)) {
    cacheLessonData(path).catch((e) => console.error('[llo-tracker] cacheLessonData failed', e));
  }

  setTimeout(() => { refreshBadges(); startMainObserver(); }, 0);
}

// ── Storage change listener ───────────────────────────────────────────────────

function onStorageChange(changes, area) {
  if (!isContextValid()) return;
  if (area !== 'local') return;
  if ('settings' in changes) {
    settings = changes.settings.newValue ?? { showInPageBadges: true };
    if (!settings.showInPageBadges) removeAllBadges();
  }
  refreshBadges();
}

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  if (!isContextValid()) {
    console.warn('[llo-tracker] extension context invalid — refresh this tab after reloading the extension.');
    return;
  }
  settings = await loadSettings();
  startPageObserver();
  chrome.storage.onChanged.addListener(onStorageChange);
  window.addEventListener('llo:navigate', onNavigate);
  onNavigate();
}

init();
