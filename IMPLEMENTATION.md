# Implementation Plan

A phased build plan for the LLO.lu Progress Tracker extension. Each
phase produces something runnable and testable before the next begins.
Don't skip ahead — Phase 4 (score capture) is the trickiest, and the
earlier phases exist to give you a working harness for testing it.

The full design is in
[`llo-tracker-extension-spec.md`](llo-tracker-extension-spec.md). The
section numbers below refer to it.

---

## Phase 0 — Repo skeleton

**Goal**: empty extension that loads in Chrome without errors.

1. Create the folder layout from spec §1: `manifest.json`,
   `background.js`, `inject.js`, `content.js`, `content.css`,
   `sidepanel/sidepanel.html`, `sidepanel/sidepanel.js`,
   `sidepanel/sidepanel.css`, `icons/`.
2. Drop in placeholder icons (16/48/128 px). Solid red squares are
   fine for now.
3. Write the `manifest.json` exactly as in spec §2.
4. Stub each JS file with a single `console.debug('[llo-tracker] <name> loaded')` line.
5. Stub `sidepanel.html` with `<h1>LLO Progress</h1>`.
6. Stub `background.js` with the snippet from spec §12 (`setPanelBehavior`).

**Verify**:

- `chrome://extensions` → Developer mode → Load unpacked → pick this
  folder. No errors on the extension card.
- Click the toolbar icon → side panel opens with `LLO Progress`.
- Visit `https://llo.lu/`. Open DevTools → Console; both `inject.js`
  and `content.js` should log "loaded".

---

## Phase 1 — Inertia data plumbing

**Goal**: detect every llo.lu navigation and read the page props.

1. Implement `inject.js` per spec §4.
2. In `content.js`:
   - Add the URL filter regexes from spec §3.
   - Add `readPageProps()` from spec §3.2.
   - Add `parseCode()` from spec §3.3.
   - Listen for the `llo:navigate` event and on each event, log: pathname, `pageProps.component`, `pageProps.props.activity?.code`, `pageProps.props.lesson?.code`, `pageProps.props.locale`.
   - Also start the `data-page` attribute observer from spec §5.6 and re-run on attribute change.
3. Trigger `onNavigate()` once on script load.

**Verify**:

- Visit the test URLs in
  [`CLAUDE.md`](CLAUDE.md#test-urls-real-exercises-that-exist).
  Console should log a navigation event with the expected component
  name (`learn/lesson`, `learn/activity-drag-and-drop`,
  `learn/activity-rule`, etc.) for each.
- Click between activities within the same lesson — each should produce a log event.
- Switch the language selector. The `/de/`, `/en/`, `/lb/` URLs and
  the bare-root FR URL should all be detected.

---

## Phase 2 — Storage and settings

**Goal**: persistent storage works and survives reloads.

1. Implement `saveScore`, `saveViewed`, `loadAllRecords`, `loadSettings`, `saveSettings` per spec §6 and §14.
2. Implement `chrome.storage.onChanged` listener stub in `content.js` (spec §5.7) — for now just log changes.
3. From the Console on a llo.lu tab, manually invoke `saveScore({…fake props…}, 4, 5)` and `saveViewed({…fake props…})` to seed data.

**Verify**:

- DevTools → Application → Storage → Extensions → LLO Tracker. Records
  appear with the correct shape from §6.
- Reload the extension. Records persist.
- Run `await chrome.storage.local.get('settings')` from the Console.
  Returns the default `{ showInPageBadges: true }`.

---

## Phase 3 — Theory dwell capture

**Goal**: visiting a grammar-rule page for ≥ 5 s adds a `viewed`
record.

Theory is the simpler of the two capture paths — implement it first to
shake out the navigation/storage plumbing.

1. In `content.js`, add `classify()` from spec §3.1.
2. Implement `startDwell` and `commitViewed` (spec §5.4).
3. Wire `onNavigate()` to call `startDwell(pd)` when `classify(pd.activity.type) === 'viewed'`.
4. On every navigation, clear the prior `viewedTimer` so navigating away cancels the dwell.

**Verify**:

- Open the theory test URL. Wait 6 s without navigating.
- Storage now has an `activity:LB_LU_A1_GRAMMAR_W_FRO_WAT_GRAMMAR_RULE_W_FRO_WAT` record with `kind: 'viewed'`, `viewCount: 1`.
- Reload the same URL. `viewCount: 2`, `lastViewed` updated.
- Navigate to the URL and quickly back (under 5 s). No record added /
  `viewCount` unchanged.

---

## Phase 4 — Score capture (the tricky one)

**Goal**: completing a scored exercise saves the correct final score.

The pitfall: `text.CircularProgressbar-text` exists in the page header
during the exercise (showing question progress like `1 / 6`) and again
in `<main>` on the result screen (showing the actual score). Capturing
the wrong one silently records bad data. The selector must always be
`main text.CircularProgressbar-text`.

1. Implement `startScoreObserver`, `checkForResult`, `commitScore` per spec §5.5.
2. Wire `onNavigate()` to call `startScoreObserver(pd)` when `classify(pd.activity.type) === 'scored'`.
3. Make sure tear-down (spec §5.8) cancels both observer and stability timer.

**Verify**:

- Open the drag-and-drop exercise test URL.
- Before answering, check storage: no record (header widget showing `1 / 6` is correctly ignored).
- Complete the exercise. Within ~1 s of the result animation
  finishing, storage gets an `activity:…` record with `kind: 'scored'`,
  `bestScore`, `bestTotal` matching what the result screen shows, and
  `passed` reflecting the 70 % rule.
- Click "Restart" and complete it again with a different score.
  `attempts: 2`, `bestScore` updated only if better, `lastCompleted`
  updated.

**Edge cases to manually exercise**:

- Submit on the very last allowed step — the count-up animation should not be captured mid-animation thanks to `STABILITY_MS`.
- Score 0/n — must be saved with `passed: false`.
- Walk away from the page after the last answer but before clicking
  Validate — no record should be saved.

---

## Phase 5 — Side panel UI

**Goal**: clicking the toolbar icon opens a panel that shows current
progress and updates live.

1. Build `sidepanel.html` with semantic structure (header, level tabs container, activity-tree container, settings section, action buttons). No content yet, just the skeleton.
2. Write `sidepanel.css` with the layout (380 px works as a starting width; the side panel resizes anyway).
3. In `sidepanel.js`:
   - Implement `loadAllRecords()` and `loadSettings()`.
   - Implement `render(state)` per spec §7.4 — single function, replaces the container fully.
   - Render: level tabs (default highlights the level with the most records), per-theme summary rows, expand-on-click activity rows.
   - Wire `chrome.storage.onChanged` to call `render(state)`.
   - Implement the **"Show progress badges on llo.lu"** checkbox bound to settings.
   - Implement **Export JSON** (Blob + temporary anchor).
   - Implement **Reset Data** with the inline confirmation flow from spec §7.2.

**Verify**:

- Click the toolbar icon → panel opens.
- The seeded records from Phase 2/3/4 show up in the right level/theme.
- Complete an exercise on llo.lu while the panel is open. The list
  updates without the user clicking anything.
- Toggle the badges checkbox. The setting persists across reloads.
- Export → JSON file downloads with the right shape.
- Reset → confirmation appears → confirm → all records clear, panel
  empty-states.

---

## Phase 6 — In-page badges

**Goal**: while browsing llo.lu, every link to a previously-attempted
activity carries a status badge.

1. Add badge styles to `content.css` for `.llo-tracker-badge`,
   `.llo-tracker-passed`, `.llo-tracker-failed`, `.llo-tracker-viewed`,
   `.llo-tracker-summary`. Light + dark variants. No `!important`.
2. In `content.js`:
   - Implement `removeAllBadges()`.
   - Implement `injectActivityCardBadges(records)` — for the lesson detail page.
   - Implement `injectLessonSummaryBadges(records)` — for the lessons index.
   - Implement `injectActivityHeaderBadge(records)` — for the activity page (small "previous best" pill).
   - Implement `refreshBadges()` per spec §13.5.
3. Wire it in:
   - Call `refreshBadges()` on `llo:navigate` after `setTimeout(0)` so llo.lu finishes painting first.
   - Call `refreshBadges()` from the storage-change listener.
   - Add a debounced `MutationObserver` on `<main>` for cases where llo.lu adds links after the initial render. Debounce ≥ 250 ms.
4. Honor `settings.showInPageBadges`. When false: skip injection, and
   call `removeAllBadges()` on the toggle event.

**Verify**:

- After Phase 4, visit the lesson page for `LB_LU_A1_GRAMMAR_W_FRO_WAT`. The completed exercise's link gets a green ✅ pill with the score.
- Visit `/en/learn/lessons` (the lessons index). Lessons with completed activities get a "1/2 done"-style summary pill.
- Visit the activity page. A small "Previous best: …" pill appears in the activity header.
- Complete an exercise. The badges on every open llo.lu tab refresh
  within a couple hundred ms, no manual reload.
- Turn the badges toggle off. All pills disappear; tracking still
  works (visit a new exercise, finish it, see it in the side panel
  but not on the page). Toggle back on. Pills reappear.
- Test with `html.dark` (use the page's theme switcher). Badges are
  legible in both modes.

---

## Phase 7 — Polish

**Goal**: ship-ready.

1. Real icons (white "LLO" on `#EF3340`).
2. Empty-state copy in the side panel ("No records yet — start an exercise on llo.lu and your progress will show up here.").
3. Friendly date display for `lastCompleted` / `lastViewed` if the
   side panel ever shows them.
4. Light/dark side-panel styling synchronized with the user's
   `prefers-color-scheme`.
5. README accuracy pass — confirm the install steps, screenshot the
   side panel and badges if you can.
6. Test once across all four locales (`/`, `/de/`, `/en/`, `/lb/`) on
   at least one scored exercise and one theory page.
7. Test once with both light and dark mode.
8. Test once with multiple llo.lu tabs open and the side panel open —
   completing an exercise in tab A should refresh badges in tab B.

---

## Out of scope for this plan

These are explicitly deferred (see spec §11 / Open Decisions):

- Toolbar-icon badge (`chrome.action.setBadgeText`).
- Cross-device sync.
- Firefox port.
- Watch progress within videos.
- A landing/options page beyond the side panel.

---

## Risk register

| Risk | Mitigation |
|---|---|
| llo.lu changes the result-screen markup | The selector `main text.CircularProgressbar-text` is the only DOM-coupled rule. Document this in the README; capture would simply stop until the extension is updated. |
| llo.lu drops `data-page` (Inertia → something else) | All capture stops; previously-stored data and badges remain functional. Unlikely without a major rewrite of llo.lu. |
| New activity type added by llo.lu | Treated as `viewed` (D13). The unknown `type` is recorded verbatim so we can revisit. |
| User runs Chrome < 114 (no `sidePanel` API) | The extension fails gracefully on the side panel; rest of capture still works. We're not committing to support older Chrome. |
| Ad-hoc DOM injection by llo.lu's React tree colliding with our badges | Class prefix `llo-tracker-` and `removeAllBadges()` before re-injecting. The `MutationObserver` on `<main>` re-runs `refreshBadges()` if links appear after our injection. |
