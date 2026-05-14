# LLO.lu Progress Tracker — Chrome Extension Spec (v2.1)

A Chrome extension (MV3) that observes the user's progress on
[llo.lu](https://llo.lu) — both **scored exercises** (drag-and-drop,
multiple choice, etc.) and **theory activities** (grammar rules,
vocabulary lists, videos) — stores them in `chrome.storage.local`, and
shows the user where they stand without making them click anything:

1. **In-page badges** appended next to existing exercise/activity links
   on llo.lu (the primary "have I done this?" UI).
2. **A side panel** (opened from the toolbar icon) for the cross-level
   browsing view, settings, and import/export.

No server, no account, no network requests, no destructive page edits.
The extension is a read-only observer of llo.lu plus an additive
overlay (decorative status pills only — no modification of llo.lu's
own DOM).

The working folder of the repo IS the extension folder. There is no
build step: plain ES modules, no bundler, no TypeScript.

---

## Verification status

The following facts were verified by fetching live llo.lu pages:

- **URL pattern**: `https://llo.lu[/{lang}]/learn/lessons/{LESSON_CODE}/{ACTIVITY_CODE}` — the `/{lang}/` segment is **omitted for the default locale (FR)** and **present for `de` / `en` / `lb`**. Confirmed by the page's own `alternate_paths` block.
- **Authoritative state lives in Inertia page props.** Each page renders `<div id="app" data-page='{...JSON...}'>`. `JSON.parse(document.getElementById('app').dataset.page)` exposes `props.activity` (with `code`, `lesson_code`, `type`, `name`, `questions`, …), `props.lesson`, `props.locale`, and the page's `component` name.
- **Activity types declared by the platform**: `DRAG_AND_DROP`, `MULTIPLE_CHOICE`, `OPEN`, `LINKS`, `CROSS_WORDS`, `WORD_SEARCH`, `FIND_TIME`, `WRITE_TIME`, `RIGHT_FALSE`, `SPELLING`, `SUMMARY_TEST`, `GRAMMAR_RULE`, `VOCABULARY_LIST`, `VIDEO`, `FLASH_CARDS`. The first eleven are scored; the last four are theory.
- **The CircularProgressbar widget appears in two places.** During an exercise it sits inside `<header>` and shows `current_question / total_questions` (e.g. `1 / 6`). On the result screen it sits inside `<main>` and shows `score / total`. Disambiguation rule: the score we want is `main text.CircularProgressbar-text`, never the in-header version.
- **Pass threshold**: 70%. Source: translation string "You need to get at least 70 % to succeed."
- **No login required** — anonymous fetch returned full activity content.
- **Themes** (third URL token, e.g. `GRAMMAR`): `vocabulary`, `grammar`, `job`. (The previous spec mislabelled this as `type`.)

---

## Open decisions (with recommended defaults)

| # | Question | Default |
|---|---|---|
| D1 | SPA navigation detection | MAIN-world history hook → `llo:navigate` event. |
| D2 | When to capture a score | Result-screen-only: `main text.CircularProgressbar-text`, with `STABILITY_MS = 800ms` debounce. |
| D3 | Pass threshold | `0.7`. Verified. |
| D4 | Background service worker? | **Yes** (minimal). Needed to set `chrome.sidePanel.setPanelBehavior` so toolbar-icon click opens the side panel. ~10 lines. |
| D5 | Daily-completed badge? | Out of scope. |
| D6 | Re-attempt within same page load | Allowed; treated as one attempt. |
| D7 | Score parses as `0/0` | Discard. |
| D8 | Icon for "attempted but not passed" | ⚠️ |
| D9 | Side-panel progress format | Absolute counts (no ratio bars). |
| D10 | Track theory? | Yes; mark as **viewed** after `VIEWED_DWELL_MS = 5000ms`. |
| D11 | Where to read `uiLang` | From `props.locale` in the Inertia page-prop JSON. |
| D12 | Inertia props missing or unparseable | **Fall back to URL parsing** for `activityCode`, `lessonCode`, and `locale`. Full props are still preferred; fallback fills in what it can. |
| D13 | Unknown `activity.type` | Treat as `viewed`. Record the type verbatim. |
| D14 | In-page badges default | **On.** User can disable in side-panel settings. |
| D15 | Where to put the in-page badge | Appended **after** the existing link/card content as a sibling span. Class-prefixed `llo-tracker-` so it can't collide with llo.lu styles. |
| D16 | Live updates | A `chrome.storage.onChanged` listener in the content script re-renders badges on every storage write so completing an exercise is reflected without a page reload. |

---

## 1. Repository layout

```
manifest.json
background.js            # Service worker — minimal; sets sidePanel behavior
inject.js                # MAIN-world: patches history, fires llo:navigate
content.js               # ISOLATED-world: capture + badge injection
content.css              # styles for in-page badges (class prefix llo-tracker-)
sidepanel/
  sidepanel.html
  sidepanel.js
  sidepanel.css
icons/
  icon16.png
  icon48.png
  icon128.png
README.md
```

---

## 2. manifest.json

```json
{
  "manifest_version": 3,
  "name": "LLO.lu Progress Tracker",
  "version": "0.0.1",
  "description": "Tracks your llo.lu progress (exercise scores and theory views) locally in your browser, with in-page badges showing what you've done.",
  "permissions": ["storage", "sidePanel"],
  "host_permissions": ["https://llo.lu/*"],
  "background": {
    "service_worker": "background.js"
  },
  "action": {
    "default_title": "LLO Progress",
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  },
  "side_panel": {
    "default_path": "sidepanel/sidepanel.html"
  },
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  },
  "content_scripts": [
    {
      "matches": ["https://llo.lu/*"],
      "js": ["inject.js"],
      "run_at": "document_start",
      "world": "MAIN"
    },
    {
      "matches": ["https://llo.lu/*"],
      "js": ["content.js"],
      "css": ["content.css"],
      "run_at": "document_idle",
      "world": "ISOLATED"
    }
  ]
}
```

`activeTab` is not needed — `host_permissions` covers what we need.

---

## 3. URL filter and activity classification

URL regex is a coarse filter only — final decisions use the Inertia
page props.

```js
// Matches both /learn/lessons/{L}/{A}  (FR default, no prefix)
//          and /{lang}/learn/lessons/{L}/{A}  (de | en | lb)
const ACTIVITY_PATH_RE =
  /^\/(?:(?<lang>de|en|lb)\/)?learn\/lessons\/(?<lesson>[^/]+)\/(?<activity>[^/]+)\/?$/;

const LESSON_PATH_RE =
  /^\/(?:(?<lang>de|en|lb)\/)?learn\/lessons\/(?<lesson>[^/]+)\/?$/;

const LESSONS_INDEX_RE =
  /^\/(?:(?<lang>de|en|lb)\/)?learn\/lessons\/?$/;

// Matches /learn/{theme}/{level} pages (e.g. /en/learn/PROGRESS_IN_THE_LANGUAGE_LB_LU/A1)
const LEVEL_PATH_RE =
  /^\/(?:(?<lang>de|en|lb)\/)?learn\/(?!lessons(?:\/|$))(?<theme>[^/]+)\/(?<level>[^/]+)\/?$/;
```

`isActivityPath` / `isLessonPath` / `isLessonsIndex` / `isLevelPath` are quick checks
used to decide whether to bother reading page props at all.

### 3.1 Activity types

```js
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
  return 'viewed'; // D13: unknown types treated as theory
}

// Fallback when data-page type is unavailable: infer from activity code tokens.
// Returns 'viewed', 'scored', or null (unknown).
function classifyFromCode(code) {
  if (!code) return null;
  const upper = code.toUpperCase();
  for (const vt of VIEWED_TYPES) {
    if (upper.includes(vt)) return 'viewed';
  }
  if (/EXERCISE|EXERCICE|QUIZ|SPELLING|FIND_TIME|WRITE_TIME|SUMMARY_TEST/.test(upper)) return 'scored';
  return null;
}
```

### 3.2 Reading Inertia page props

```js
function readPageProps() {
  const el = document.getElementById('app');
  if (!el || !el.dataset.page) return null;
  try {
    return JSON.parse(el.dataset.page);
  } catch {
    return null;
  }
}
```

The Inertia envelope is `{component, props: {locale, activity?, lesson?, …}}`.
Activity-page payload includes `props.activity.{code, lesson_code, type, name, questions}`.
Lesson-page payload includes `props.lesson.{code, name, level: {name}, activities: […]}`.

### 3.3 Deriving display fields from `activity.code`

```
LB_LU_A1_GRAMMAR_W_FRO_WAT_EXERCISE_EXERCICE_WAT
└┬─┘ └┬┘ └─┬───┘ └─────┬─────────┘
 │    │    │           └ rest
 │    │    └ theme  (GRAMMAR | VOCABULARY | JOB | …)
 │    └ level  (A1 | A2 | B1 | B2)
 └ content language ("LB_LU")
```

```js
function parseCode(code) {
  const m = code.match(/^([A-Z]{2})_([A-Z]{2})_(.+)$/);
  if (!m) return null;
  const [, contentLang, contentRegion, rest] = m;
  const tokens = rest.split('_');
  if (tokens.length < 3) return null;
  const [level, theme, ...lessonNameTokens] = tokens;
  return {
    contentLang: contentLang + '_' + contentRegion,
    level,
    theme,
    lessonName: lessonNameTokens.join('_'),
  };
}
```

---

## 4. inject.js (MAIN world, unchanged)

```js
(() => {
  const fire = () => window.dispatchEvent(new CustomEvent('llo:navigate'));
  for (const m of ['pushState', 'replaceState']) {
    const orig = history[m];
    history[m] = function (...a) {
      const r = orig.apply(this, a);
      fire();
      return r;
    };
  }
  window.addEventListener('popstate', fire);
})();
```

---

## 5. content.js

### 5.1 Module state

```js
const PASS_THRESHOLD  = 0.7;
const STABILITY_MS    = 800;
const VIEWED_DWELL_MS = 5000;

let scoreObserver      = null;  // MutationObserver: result-screen score
let pageObserver       = null;  // MutationObserver: #app[data-page]
let stabilityTimer     = null;
let viewedTimer        = null;
let lastSeenText       = null;
let currentCapturePath = null;  // path for which capture was started
const savedThisLoad    = new Set();

let badgeDebounceTimer = null;
let mainBadgeObserver  = null;
let badgeRefreshing    = false;  // prevents recursive refresh from MutationObserver

let settings = { showInPageBadges: true };  // hydrated on init
```

### 5.2 Lifecycle

```js
async function init() {
  settings = await loadSettings();
  startPageObserver();
  chrome.storage.onChanged.addListener(onStorageChange);
  window.addEventListener('llo:navigate', onNavigate);
  onNavigate();
}
init();
```

### 5.3 `onNavigate()`

`onNavigate()` is fired both by `llo:navigate` (history changes) and by the `data-page` attribute observer (Inertia partial visits that don't fire history events). Because Inertia emits multiple `data-page` mutations per navigation, the function tracks `currentCapturePath`:

- If `location.pathname !== currentCapturePath`: genuine new navigation → call `teardown()`, set `currentCapturePath`, start capture.
- If path is the same: Inertia partial update at same URL → skip teardown and capture; only refresh badges.

Capture (on genuine activity-path navigation):
- Always start **both** `startScoreObserver(path)` and `startDwell(path)`. `commitViewed` re-checks the activity type at its 5 s fire time and blocks itself if the type is scored. `commitScore` cancels the dwell timer when a result is found first.

In all cases (both branches), on lesson pages call `cacheLessonData()` and always run `refreshBadges()` + `startMainObserver()` via `setTimeout(0)` (to let llo.lu paint first).

### 5.4 Theory: dwell-timer capture

```js
function startDwell(path) {
  viewedTimer = setTimeout(() => commitViewed(path), VIEWED_DWELL_MS);
}

function commitViewed(path) {
  // Re-read page props at fire time (5 s later) — they're now reliable.
  const pd       = readPageProps();
  const activity = pd?.props?.activity;
  const type     = activity?.type;
  const code     = activity?.code ?? activityCodeFromPath(path);

  // Block if this is a scored exercise (user may be mid-exercise without result yet).
  if (type && SCORED_TYPES.has(type)) return;
  if (!type && classifyFromCode(code) === 'scored') return;

  if (!code) return;
  if (savedThisLoad.has(code)) return;
  savedThisLoad.add(code);
  saveViewed(path);
}
```

### 5.5 Scored: result-screen observer

The result screen shows the score as a **percentage** in `<main>` textContent (e.g. `83 %`). We read this from the entire `main` text rather than a specific widget, because the CircularProgressbar widgets show question-answered counts (`6/6`), not the actual score percentage.

**Guard against false positives**: `checkForResult` first checks the current activity type. If the type is a known theory type (or the code looks like a theory activity via `classifyFromCode`), it returns early — this prevents percentage strings that appear in theory content (e.g. "80% of sentences…") from being mistaken for a score.

```js
function startScoreObserver(path) {
  scoreObserver = new MutationObserver(() => checkForResult(path));
  scoreObserver.observe(document.body, { childList: true, subtree: true });
  checkForResult(path);
}

function checkForResult(path) {
  // Re-check type guard each call (props may update mid-exercise).
  const activity = readPageProps()?.props?.activity;
  const type     = activity?.type;
  const code     = activity?.code ?? activityCodeFromPath(path);
  if (type && !SCORED_TYPES.has(type)) return;
  if (!type && classifyFromCode(code) === 'viewed') return;

  // Look for a percentage in <main> textContent.
  const mainText = document.querySelector('main')?.textContent ?? '';
  const m = mainText.match(/\b(\d+(?:\.\d+)?)\s*%/);
  if (!m) return;

  const pct = parseFloat(m[1]);
  if (pct < 0 || pct > 100) return;

  const canonText = `${Math.round(pct)}%`;
  if (canonText === lastSeenText) return;

  lastSeenText = canonText;
  clearTimeout(stabilityTimer);
  stabilityTimer = setTimeout(
    () => commitScore(path, Math.round(pct), 100),
    STABILITY_MS
  );
}

function commitScore(path, score, total) {
  const code = readPageProps()?.props?.activity?.code ?? activityCodeFromPath(path);
  if (!code) return;
  if (savedThisLoad.has(code)) return;
  savedThisLoad.add(code);
  clearTimeout(viewedTimer); viewedTimer = null;  // score wins over dwell
  saveScore(path, score, total);
  scoreObserver?.disconnect(); scoreObserver = null;
}
```

Scores are stored with `total = 100` (i.e. `bestScore` is the rounded percentage, `bestTotal` is always 100). This means `bestScore / bestTotal` equals the displayed percentage directly.

### 5.6 `data-page` attribute observer

```js
function startPageObserver() {
  const el = document.getElementById('app');
  if (!el) return;
  pageObserver = new MutationObserver(onNavigate);
  pageObserver.observe(el, {
    attributes: true,
    attributeFilter: ['data-page'],
  });
}
```

This catches Inertia partial visits where `data-page` changes without a
`pushState` call.

### 5.7 Storage-change listener

```js
function onStorageChange(changes, area) {
  if (area !== 'local') return;
  if ('settings' in changes) {
    settings = changes.settings.newValue ?? { showInPageBadges: true };
  }
  // Any activity record change → re-render badges
  refreshBadges();
}
```

### 5.8 Tear-down per-page

```js
function teardown() {
  scoreObserver?.disconnect(); scoreObserver = null;
  clearTimeout(stabilityTimer); stabilityTimer = null;
  clearTimeout(viewedTimer);    viewedTimer    = null;
  lastSeenText       = null;
  currentCapturePath = null;
  savedThisLoad.clear();
  removeAllBadges();
  // pageObserver and storage listener stay for the lifetime of the tab.
}
```

---

## 6. Storage model

### Key scheme

`chrome.storage.local`, flat keys:

```
activity:{activityCode}  →  ActivityRecord
lesson:{lessonCode}      →  LessonCache
settings                 →  Settings
```

`lesson:*` keys are written whenever the content script sees a lesson page (i.e. `isLessonPath(path)`) with valid `props.lesson.activities`. They let the badge code show accurate `done/total` counts even on pages that don't list all activities in the current view. See §6.4.

### `ActivityRecord` (scored)

```js
{
  kind:           "scored",
  activityCode:   string,
  lessonCode:     string,
  activityType:   string,        // e.g. "DRAG_AND_DROP"
  activityName:   string,        // human-readable
  lessonName:     string,
  level:          string,        // "A1" | "A2" | "B1" | "B2"
  theme:          string,        // "GRAMMAR" | "VOCABULARY" | …
  uiLang:         string,
  bestScore:      number,        // best rounded percentage (0–100); bestTotal is always 100
  bestTotal:      number,        // always 100
  lastScore:      number,        // score of the most recent attempt
  lastTotal:      number,        // total of the most recent attempt (always 100)
  attempts:       number,
  firstCompleted: string,        // ISO 8601
  lastCompleted:  string,
  passed:         boolean,       // ever passed (once true, stays true)
}
```

`bestScore / bestTotal` is the displayed percentage. `lastScore` / `lastTotal` record the most recent attempt and are shown in the side panel as "83% best / 67% last" when they differ from the best.

### `ActivityRecord` (viewed)

```js
{
  kind:           "viewed",
  activityCode:   string,
  lessonCode:     string,
  activityType:   string,        // e.g. "GRAMMAR_RULE"
  activityName:   string,
  lessonName:     string,
  level:          string,
  theme:          string,
  uiLang:         string,
  viewCount:      number,
  firstViewed:    string,
  lastViewed:     string,
}
```

### `Settings`

```js
{
  showInPageBadges: boolean,   // default true
  // future: dwellMs, theme override, etc.
}
```

### `LessonCache`

```js
{
  lessonCode: string,
  lessonName: string,
  activities: [{ code: string, type: string, name: string }],
  cachedAt:   string,  // ISO 8601
}
```

Written by `cacheLessonData(path)` whenever the content script lands on a lesson page. Used by `injectLessonSummaryBadges` and `injectMissionBadges` to compute accurate `done/total` fractions.

### `saveScore(path, score, total)` and `saveViewed(path)`

Both functions read Inertia page props at call time, but also fall back to URL parsing if props are unavailable (D12 override — see Open Decisions). On every save, the storage-change listener fires and refreshes both the side panel and any open llo.lu tabs' in-page badges.

---

## 7. Side panel UI

Replaces the popup of v2. The side panel opens when the user clicks the
extension's toolbar icon (configured by `background.js`, §12), stays
open while the user browses, and resizes with Chrome's side-panel
column.

### 7.1 Layout

```
┌─────────────────────────────────────┐
│ 🇱🇺 LLO.lu Progress Tracker         │
│                                     │
│ [A1] [A2] [B1] [B2]                │
│                                     │
│ A1 — 12 scored, 8 viewed            │
│   GRAMMAR        7s / 4v           │
│   VOCABULARY     5s / 4v           │
│                                     │
│ ▼ GRAMMAR                          │
│   📖 W-Fro: Wat ...? (rule)  v×2   │
│   ✅ Exercice: Wat ...?  4/4 100%   │
│   ⚠️  Exercice: …Wéi    2/5  40%    │
│                                     │
│ ─────────────────────────────────── │
│ Settings                            │
│ [ ] Show progress badges on llo.lu  │
│                                     │
│ [Export JSON]      [Reset Data]    │
└─────────────────────────────────────┘
```

### 7.2 Behaviour

On open:

1. `const all = await chrome.storage.local.get(null)`.
2. Filter to keys starting with `activity:` for records, plus the
   `settings` key.
3. Group records by `level` then `theme`. Sort levels A1→B2; sort
   themes alphabetically; sort within a theme by `lessonName`, then
   `activityName`.
4. Default selected level = the level with the most records (ties
   broken A1→B2). Empty state if none.

Type-row counts use the format `Ns / Mv` (N scored, M viewed).

Per-activity row:

| Kind | Icon | Right-side label |
|---|---|---|
| viewed | 📖 | `v×{viewCount}` |
| scored, passed | ✅ | `NN% best [/ MM% last] [(×N)]` |
| scored, !passed | ⚠️ | `NN% best [/ MM% last] [(×N)]` |

If `lastScore !== bestScore`, show "83% best / 67% last". If `attempts > 1`, append ` (×N)`. Because scores are stored as percentages (`bestTotal = 100`), the display is simply `bestScore%`.

Date of last completion/view is shown below the score in a smaller style.

Settings section: a checkbox bound to `settings.showInPageBadges`. On
change, write the new settings object to `chrome.storage.local`. The
content script's storage listener picks it up and refreshes badges.

Buttons:

- **Export JSON**: build `{ exportedAt, version: "2.1.0", settings, activities: { ... } }`, save as `llo-progress-YYYY-MM-DD.json`. (`VERSION` constant in `sidepanel.js` is `"2.1.0"` and is independent of the manifest version.)
- **Reset Data**: replaces both buttons with `Are you sure? [Cancel] [Yes, delete all]`. Confirm → `await chrome.storage.local.clear()` then re-render. (Settings reset to defaults.)

### 7.3 Live updates

The side panel registers `chrome.storage.onChanged.addListener(...)`
and re-renders on any change. So finishing an exercise on llo.lu while
the panel is open updates the list in real time.

### 7.4 Architecture notes (to keep portable)

The panel is plain HTML/JS, no framework — but written so that swapping
in Preact/Lit later is mechanical:

- Render is one function `render(state) → DOM`. Container is fully
  replaced (`container.replaceChildren(buildTree(state))`). No
  per-element imperative mutation.
- All state lives in one in-memory object. Nothing in `data-*`
  attributes.
- All llo.lu-sourced strings rendered via `textContent`, never
  `innerHTML` concatenation.

---

## 8. Icons

Three PNGs at 16/48/128 px. Suggested: white "LLO" on a flag-red
background (`#EF3340`). Solid-swatch placeholders are acceptable.

---

## 9. Edge cases

| Scenario | Behaviour |
|---|---|
| User leaves before result screen | No score record. (Theory dwell may still trigger if applicable.) |
| Animated count-up on result screen | Captured as final value via `STABILITY_MS` debounce. |
| Retry; new score higher | `bestScore`/`bestTotal` updated; `attempts++`. |
| Retry; new score same/lower | `bestScore` unchanged; `attempts++`. |
| Re-attempt without navigating | One attempt (D6). |
| `total === 0` | Discarded. |
| In-progress page never reaches result | Observer remains attached until next nav. |
| User changes UI language mid-activity | `uiLang` updated. |
| Multiple llo.lu tabs open | Each content script independent; last write wins per key. Badges refresh in every tab via storage-change listener. |
| `chrome.storage.local` quota | Far below 10 MB MV3 limit. |
| llo.lu changes the result selector | Score capture stops. Theory and badges still work for already-recorded items. README must call this out. |
| llo.lu drops the `data-page` attribute | All capture stops; badges still render from previously-stored records. |
| llo.lu adds a new activity type | Treated as `viewed` (D13); type recorded verbatim. |
| Theory page revisited briefly (<5s) | Not recorded. |
| Theory page already recorded as `scored` | Not downgraded. |
| User toggles "Show badges" off | `refreshBadges()` removes existing badges; no further injection. |
| Dynamic page renders new activity links after badges drew | A `MutationObserver` on `<main>` re-runs `refreshBadges()` (debounced); see §13.5. |

---

## 10. README.md (contents to write)

1. **What it does**: tracks both your scored exercises and your theory views on llo.lu, locally in your browser; shows status badges next to each activity link on llo.lu and a side panel for the cross-level overview.
2. **Install (developer mode)**: clone → `chrome://extensions` → Developer Mode → "Load unpacked" → select the cloned folder.
3. **How it works**: reads the page's already-public Inertia state (`#app[data-page]`), observes the result screen for scored activities, and appends decorative status badges next to existing exercise links. No network requests; only `https://llo.lu/*` is touched.
4. **Privacy**: nothing leaves the browser.
5. **Disabling badges**: the side panel has a "Show progress badges on llo.lu" toggle; turning it off removes all badges.
6. **Export & reset**: side panel buttons; the JSON export shape.
7. **Known limitations**:
   - Cannot enumerate activities you haven't yet visited.
   - Score captured only when the result screen renders; navigating away early loses it.
   - If llo.lu drops `data-page` or changes the result-screen markup, capture stops.
   - Theory dwell is 5 s; shorter visits aren't recorded.

---

## 11. Non-goals (v2.1)

- Cross-device sync.
- Firefox port.
- Tracking watch progress within videos.
- Knowing platform-wide activity counts.
- Any network or remote storage.
- Modifying llo.lu's existing DOM. **(Adding new sibling elements with a
  unique class prefix is not "modifying" in this sense — see §13.6.)**
- Streaks, XP, gamification.
- A toolbar-icon badge (`chrome.action.setBadgeText`) — possible later;
  for v2.1 the side panel and in-page badges cover the surface.

---

## 12. background.js (service worker)

Minimal — its only job is to make the toolbar icon open the side panel:

```js
// background.js
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((e) => console.error(e));
});
```

Nothing else lives here in v2.1. If a future version adds a toolbar
badge or alarms, they'd go here.

---

## 13. In-page badges

The primary "have I done this?" UI. The content script appends small
decorative status pills next to existing exercise/activity links on
llo.lu, so the user can see at a glance which activities they've
already attempted while browsing.

### 13.1 Where badges appear

- **Lesson detail page** (`…/learn/lessons/{LESSON_CODE}`) — one badge on each activity link.
- **Lessons index** (`…/learn/lessons`) — one badge on each lesson card, summarizing its activities (e.g. `2/3 done`, or `✓ all done`).
- **Level / theme browser pages** (`…/learn/{theme}/{level}`, matched by `LEVEL_PATH_RE`) — lesson-card summary badges, **plus** a level progress banner at the top of `<main>` and per-mission progress badges on accordion triggers.
- **Activity page** (`…/learn/lessons/{L}/{A}`) — a status badge appended to `<header>` showing the previous best.

### 13.2 How the content script finds links to badge

For activity-level badges (lesson detail page):

1. Read `props.lesson.activities` from the Inertia data — gives every activity's `code` on the page directly.
2. Match each `<a>` whose `href` ends with `/{lesson_code}/{activity_code}`.
3. Look up `activity:{activity_code}` in `chrome.storage.local`.
4. If found, append a badge span as the last child of the link.

For lesson-level summary badges (index / kickstart):

1. Find each `<a>` whose href matches `LESSON_PATH_RE`.
2. Extract the lesson code from the href.
3. Query all `activity:*` records, filter by `lessonCode`. Compute counts.
4. Append a summary badge to the lesson card.

### 13.3 Badge variants

```html
<span class="llo-tracker-badge llo-tracker-passed">✓ 4/4</span>
<span class="llo-tracker-badge llo-tracker-failed">⚠ 2/5</span>
<span class="llo-tracker-badge llo-tracker-viewed">📖 ×2</span>
<span class="llo-tracker-badge llo-tracker-summary">2/3 done</span>
```

Visual style (defined in `content.css`):

- ~11 px font, slightly muted, rounded-full
- Distinct outer border so it visibly belongs to the extension, not the page
- A small leading attribution dot (`::before` content `'•'` or similar) so users hovering see this is from "LLO Tracker" via the badge's `title` attribute
- Light-mode and dark-mode variants matching the page's `html.dark` class

### 13.4 Class prefix and style isolation

All extension-added classes start with `llo-tracker-`. CSS lives in
`content.css` (loaded via `manifest.content_scripts[].css`), scoped
exclusively to those classes. We do not write rules that target
llo.lu's own selectors.

We avoid `!important` everywhere; if llo.lu's styles ever cascade in,
we add a more specific selector — but we don't override site styles.

### 13.5 Update lifecycle

```js
function removeAllBadges() {
  document.querySelectorAll('.llo-tracker-badge, .llo-tracker-level-banner').forEach((b) => b.remove());
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
```

`refreshBadges()` does **not** remove badges before re-running. Instead each inject function checks whether a badge already exists on each element and skips (same text) or replaces (text changed). `removeAllBadges()` is called only in `teardown()` (on genuine navigation). This avoids a visible flash on partial data-page updates.

`badgeRefreshing` prevents the `MutationObserver` on `<main>` from triggering a recursive refresh when our own injection mutates the DOM.

`refreshBadges()` is called:

- On every `llo:navigate` after `setTimeout(0)` (lets llo.lu paint first).
- On every `chrome.storage.onChanged` event.
- Via the debounced `MutationObserver` on `<main>` (≥ 250 ms) for cases where llo.lu adds links after the initial render.

### 13.8 Level/mission badges (level pages only)

Two additional badge types are injected when `isLevelPath(path)`:

**Level progress banner** — a `div.llo-tracker-level-banner` inserted as the first child of `<main>`, showing "A1: 3/12 lessons started, 5 exercises passed". Driven by `props.missions` from Inertia and the lesson cache. Removed and re-created on each `refreshBadges()` call.

**Mission badges** — accordion triggers on level pages are `button[aria-expanded]:not([aria-haspopup])`. For each mission in `props.missions` whose name matches a button's text, a summary badge is appended showing lesson progress: `✓ N lessons`, `N done, M started`, or `N/total started`. Uses the lesson cache for accurate "fully done" detection.

### 13.6 What "additive overlay" means precisely

The extension is allowed to:

- **Append** new elements as children/siblings of llo.lu's elements, with classes prefixed `llo-tracker-`.
- **Read** the DOM and Inertia state.
- **Listen** to events on its own injected elements.

The extension does not:

- Change attributes, text, or children of llo.lu's existing elements.
- Replace or remove llo.lu's elements.
- Intercept or modify any of llo.lu's events.
- Submit any form, click any button, or otherwise affect llo.lu's app
  state.

This is the principle relaxation from the previous "no modification"
rule — additive only, clearly attributed, fully reversible (toggle
off → all badges gone).

### 13.7 User control

The "Show progress badges on llo.lu" toggle in the side-panel settings
section is the single switch. Default: on. When off, no DOM injection
happens; capture and storage continue to work normally.

---

## 14. Settings storage

```js
const DEFAULT_SETTINGS = { showInPageBadges: true };

async function loadSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...(settings ?? {}) };
}

async function saveSettings(next) {
  await chrome.storage.local.set({ settings: next });
}
```

The side panel reads/writes via these helpers. Both content.js and
sidepanel.js subscribe to `chrome.storage.onChanged` so a settings
change in the panel is reflected immediately in any open llo.lu tab.

---

## 15. Migration from v1 / v2

Neither v1 nor v2 has shipped. v2.1 is the first release.

If we ever need to migrate stored data (e.g. v3 changes the record
shape), the service worker's `onInstalled` handler is where the
migration runs.
