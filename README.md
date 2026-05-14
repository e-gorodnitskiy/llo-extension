# Progress Tracker for LLO.lu

An unofficial Chrome extension that quietly tracks your progress on
[llo.lu](https://llo.lu) — both scored exercises and theory activities
(grammar rules, vocabulary lists, videos) — and shows you what you've
already done, both as small badges next to each exercise on llo.lu and
as a side-panel overview.

Everything is stored locally in your browser. No account, no server,
no network requests, no analytics.

## Why this exists

In January 2026, LLO.lu redesigned its platform to open access for
everyone, with no account creation required. As part of that
transition, user accounts were deactivated and the built-in progress
tracking went away. This extension is an independent, local-only tool
that lets learners keep their own progress history on their own
device.

> This extension is an independent project and is **not affiliated
> with, endorsed by, or connected to** llo.lu, the Institut National
> des Langues Luxembourg, the Luxembourg Ministry of Education, or
> ALTISSIA. "LLO.lu" is used here only to describe which site this
> extension works with.

## What it tracks

- **Scored exercises** (drag-and-drop, multiple choice, write-the-time, etc.): your best score, total attempts, and whether you passed (≥ 70 %).
- **Theory activities** (grammar rules, vocabulary lists, videos, flashcards): marked as "viewed" once you've spent at least 5 seconds on the page.

## Install (developer mode, while not yet on the Chrome Web Store)

1. Clone or download this repository.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode** (toggle in the top-right).
4. Click **Load unpacked** and select this folder.
5. The extension's icon should appear in the toolbar. Pin it for easy access.
6. Visit [llo.lu](https://llo.lu) and start any exercise.

## How it shows you progress

**Badges on llo.lu pages.** While you browse the site, small status
pills appear next to each exercise link and lesson card:

- ✅ green pill with score (e.g. `83%`) — passed
- ⚠️ yellow pill with score (e.g. `50%`) — attempted but didn't pass
- 📖 blue pill with view count — theory you've viewed
- Summary pills on lesson cards (e.g. `2/3`) showing how many activities in that lesson you've done
- On level pages, a banner at the top of the page and per-mission pills on accordion sections

If you've attempted something more than once, the badge shows your best and most recent score (e.g. `83% best / 50% last`).

You can turn these off if you prefer a clean page (see _Disabling
badges_ below).

**Side panel.** Click the extension's toolbar icon to open the side
panel. It groups your progress by level (A1 → B2) and theme (grammar,
vocabulary, …), and stays open while you work.

## How it works (briefly)

The extension reads the page's already-public state — the same data the
llo.lu app itself uses to render — to identify each activity. For
scored exercises it watches for the result screen to appear and records
your final score. For theory pages it waits until you've stayed on the
page long enough to count it as a real visit. Everything is written to
`chrome.storage.local`. No HTTP requests are made.

## Privacy

See [`docs/privacy.html`](docs/privacy.html) for the full policy. In short:

- The extension does not send your progress data to any server. All tracked data is stored locally in your browser using `chrome.storage.local` and is not shared with the developer or any third party.
- The extension only activates on `https://llo.lu/*`. It does nothing on any other domain.
- It does not modify llo.lu's content or behavior; it only appends small status badges as siblings of existing links.

## Disabling badges

Open the side panel (toolbar icon) and uncheck **"Show progress
badges on llo.lu"**. Badges disappear immediately on every open llo.lu
tab; tracking continues normally in the background.

## Export and reset

The side panel has two buttons at the bottom:

- **Export JSON** — saves a `llo-progress-YYYY-MM-DD.json` file with all your records and current settings.
- **Reset Data** — clears every record (asks for confirmation first).

Exports are intentionally human-readable so you can keep your own
backups or move data between browsers manually.

## Known limitations

- The extension learns a lesson's full activity list by caching the lesson detail page when you visit it. Until you've visited a lesson page, summary badges can only count what you've already done, not the total.
- A score is captured only when the result screen is shown. If you
  navigate away from an exercise before the result appears, that
  attempt isn't recorded.
- A theory page must be open for at least 5 seconds to count as
  viewed (so accidental clicks don't pollute your data).
- If llo.lu changes its result-screen markup, score capture may stop
  working until the extension is updated. Theory tracking and
  previously-recorded data are unaffected.

## Built without a build step

This is plain JavaScript, no bundler, no TypeScript, no frameworks.
You can read every line of source directly. The repository folder _is_
the extension — `chrome://extensions` → Load unpacked → pick this
folder is all there is to it.

## License

MIT (see [`LICENSE`](LICENSE)).

## Trademarks and affiliation

"LLO.lu", "Léier Lëtzebuergesch Online", and any related logos are the
property of their respective owners (the Institut National des Langues
Luxembourg, the Luxembourg Ministry of Education, Children and Youth,
and/or ALTISSIA INTERNATIONAL S.A.). The name is used here in a
descriptive sense only — to indicate which website this extension is
designed to work with — and does not imply any affiliation with or
endorsement by those parties.

If you are a rights holder and would like changes to this project,
please open an issue on the repository.
