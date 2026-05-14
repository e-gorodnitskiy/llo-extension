# CLAUDE.md

Notes for future Claude sessions working on this codebase.

## Project at a glance

This folder is the Chrome extension itself — there is no separate "src"
or "build" tree. When the user runs `chrome://extensions` → "Load
unpacked" → picks this folder, Chrome loads the manifest from the root.
There is no build step, no bundler, no TypeScript. Plain ES modules
and standard browser APIs only.

The full spec is in [`llo-tracker-extension-spec.md`](llo-tracker-extension-spec.md).
The phased build plan is in [`IMPLEMENTATION.md`](IMPLEMENTATION.md).
Read the spec end-to-end before making non-trivial changes — a few
specifics on the live llo.lu site are easy to get wrong without
context, and they're called out in §verification of the spec.

## Verified facts about llo.lu (don't re-derive)

These were checked against the live site by fetching real pages. If
something here ever conflicts with current behavior, llo.lu changed —
update this section.

- **URL pattern**: `https://llo.lu[/{lang}]/learn/lessons/{LESSON_CODE}/{ACTIVITY_CODE}`. The `/{lang}/` segment is **omitted for the default locale (FR)** and present for `de` / `en` / `lb`. Don't write a regex that requires the lang segment.
- **Authoritative metadata is in Inertia page props**: `JSON.parse(document.getElementById('app').dataset.page)` gives `{component, props: {locale, activity?, lesson?, …}}`. Prefer this over URL parsing or DOM scraping.
- **Score capture**: the result screen shows the score as a **percentage** (`83 %`) in the `<main>` textContent. The code reads this with `/\b(\d+(?:\.\d+)?)\s*%/` on `document.querySelector('main')?.textContent` — **not** via `text.CircularProgressbar-text`. Scores are stored as `bestScore` (rounded integer) out of `bestTotal = 100`. The CircularProgressbar widgets show question-answered counts (`6/6`), not the percentage, so they are not used.
- **Activity types**: `DRAG_AND_DROP`, `MULTIPLE_CHOICE`, `OPEN`, `LINKS`, `CROSS_WORDS`, `WORD_SEARCH`, `FIND_TIME`, `WRITE_TIME`, `RIGHT_FALSE`, `SPELLING`, `SUMMARY_TEST` are scored. `GRAMMAR_RULE`, `VOCABULARY_LIST`, `VIDEO`, `FLASH_CARDS` are theory (viewed). Unknown future types default to viewed (D13 in the spec).
- **Pass threshold**: 70%.
- **No login required.** Anonymous fetches return full content.
- **Inertia partial visits** can swap `data-page` content without firing `pushState`. The content script needs both the history hook and a `MutationObserver` watching `#app[data-page]` to catch every navigation.

## Test URLs (real exercises that exist)

```
Lesson page (DOM has list of activities in props.lesson.activities):
  https://llo.lu/en/learn/lessons/LB_LU_A1_GRAMMAR_W_FRO_WAT

Exercise (type DRAG_AND_DROP, six questions, scored):
  https://llo.lu/en/learn/lessons/LB_LU_A1_GRAMMAR_W_FRO_WAT/LB_LU_A1_GRAMMAR_W_FRO_WAT_EXERCISE_EXERCICE_WAT

Theory (type GRAMMAR_RULE, viewed):
  https://llo.lu/en/learn/lessons/LB_LU_A1_GRAMMAR_W_FRO_WAT/LB_LU_A1_GRAMMAR_W_FRO_WAT_GRAMMAR_RULE_W_FRO_WAT
```

The same lesson at the other locales (drop the `/en/` for FR):

```
/learn/lessons/LB_LU_A1_GRAMMAR_W_FRO_WAT          (FR — note no prefix)
/de/learn/lessons/LB_LU_A1_GRAMMAR_W_FRO_WAT       (DE)
/lb/learn/lessons/LB_LU_A1_GRAMMAR_W_FRO_WAT       (LB)
```

When testing, hit at least the FR (no-prefix) and EN URLs to confirm
both branches of the URL filter work.

## Conventions for this codebase

- **No build step, no TypeScript.** Plain ES modules. If a change tempts you to add a bundler, talk to the user first — it's a deliberate simplicity choice.
- **All extension-added DOM uses the `llo-tracker-` class prefix.** Never reuse llo.lu's class names. Never write CSS rules targeting llo.lu's selectors.
- **No `!important` in `content.css`.** If specificity becomes an issue, add a more specific selector, don't override.
- **All llo.lu-sourced strings render via `textContent`**, never via `innerHTML` concatenation. Activity and lesson names come from the platform — treat them as untrusted.
- **Render the side panel as one `render(state)` call** that fully replaces its container. Don't mutate individual elements imperatively.
- **State lives in one in-memory object**, never in `data-*` attributes.
- **Additive-only DOM** on llo.lu pages. We never modify, replace, or remove llo.lu's own elements; we only append our own siblings/children. See spec §13.6.

## Files in this repo

| Path | Purpose |
|---|---|
| `manifest.json` | MV3 manifest. Permissions: `storage`, `sidePanel`. Host: `https://llo.lu/*`. |
| `background.js` | Service worker. Only sets `sidePanel.setPanelBehavior` so toolbar-icon click opens the panel. |
| `inject.js` | MAIN-world: patches `history.pushState/replaceState` and dispatches `llo:navigate`. |
| `content.js` | ISOLATED-world: capture lifecycle, badge injection, settings, storage. Also caches `lesson:*` records when visiting lesson pages (used for accurate done/total badge counts). Injects level-banner and mission badges on `/learn/{theme}/{level}` pages. |
| `content.css` | Badge styling (light + dark). All selectors prefixed `llo-tracker-`. |
| `sidepanel/sidepanel.html` | Side panel shell. |
| `sidepanel/sidepanel.js` | Side panel logic — load records, render, settings, export/reset. |
| `sidepanel/sidepanel.css` | Side panel styles. |
| `icons/` | 16 / 48 / 128 px PNGs. |
| `llo-tracker-extension-spec.md` | The full spec. Source of truth for behavior. |
| `IMPLEMENTATION.md` | Phased build plan with verification steps. |
| `README.md` | User-facing readme. |

## Manual testing workflow

1. `chrome://extensions` → Developer mode → Load unpacked → pick this folder.
2. Open one of the test URLs above.
3. Open DevTools → Console; look for any errors from the extension.
4. Open Application tab → Storage → Extensions → this extension; watch records appear as you complete activities.
5. Click the toolbar icon → side panel opens.
6. To reload after a code change: extension card → reload icon, then refresh the llo.lu tab.

For the score-capture path specifically: complete a short exercise
(e.g. the `EXERCICE_WAT` link above) and watch the result screen
render. The record should appear in storage within `STABILITY_MS`
(800ms) of the score widget settling.

## Common gotchas when editing

- The score is read from `document.querySelector('main')?.textContent` using a `%` regex. A false-positive risk: theory pages sometimes contain percentage strings (e.g. "80% of sentences use…"). The guard in `checkForResult` short-circuits when the activity type is a known theory type or `classifyFromCode` returns `'viewed'` — don't remove or weaken that guard.
- The FR locale URL has no language prefix. Test with the bare `/learn/lessons/...` path.
- After saving a record, the storage-change listener fires and triggers a badge refresh in every open llo.lu tab. Don't accidentally write storage in a loop from the badge code itself.
- Lesson cache (`lesson:*` keys) is written from `content.js` whenever a lesson page loads. `refreshBadges` reads it to show accurate `done/total` counts on lesson cards. If you add fields to the cache, bump `cachedAt` logic so stale entries don't mislead the badge math.
- `chrome.sidePanel` requires Chrome 114+. The user is fine with that — don't try to support older versions.

## Where to look first when something is wrong

| Symptom | First place to look |
|---|---|
| Score not captured | `content.js` `checkForResult`; verify `document.querySelector('main')?.textContent` contains a `%` on the result screen, and that the activity-type guard isn't blocking it. |
| Score recorded wrongly (theory page) | The type guard in `checkForResult` — ensure `SCORED_TYPES` and `classifyFromCode` correctly identify the activity. |
| Badges don't appear | `settings.showInPageBadges`; `content.css` loaded; `refreshBadges()` called on `llo:navigate`. |
| Level banner / mission badges missing | `LEVEL_PATH_RE` must match the URL; `props.missions` must be in Inertia data; lesson cache (`lesson:*`) must exist for accurate "done" counts. |
| Lesson card shows wrong done/total | Lesson cache may be stale or absent — visit the lesson detail page to refresh it. |
| Side panel won't open from icon | `background.js` set `openPanelOnActionClick: true`? |
| FR locale users not tracked | `ACTIVITY_PATH_RE` — is the lang segment optional? |
| Theory not recorded | Dwell timer cleared too early on tear-down. |

## When asked to "verify spec assumptions" or similar

The verified-facts section in the spec was built by fetching live llo.lu
pages with `mcp__workspace__web_fetch`. To re-verify in the future:

```
fetch https://llo.lu/                                     # default FR home
fetch https://llo.lu/en/learn/lessons/{any LESSON_CODE}   # lesson page
fetch https://llo.lu/en/learn/lessons/{L}/{A}             # exercise page
```

The Inertia page-prop JSON is in the `data-page` attribute of `#app`;
extract and JSON-parse it to inspect the schema. Don't hand-write a
parser based on the URL alone.
