# SnackToGit

SnackToGit is a Chrome extension that takes a project exported from Expo Snack and commits it straight into a GitHub repository, without downloading a zip, extracting it, and running git commands by hand.

## How it works

A button labeled Commitar is injected into the Snack page next to the Expo Docs link. Clicking it opens the extension popup. Inside the popup you can trigger a fresh export from the active Snack tab, or pick an existing download from the recent list. Once a zip is selected, you choose the destination repository, branch, and an optional folder inside that repository, then confirm.

The extension downloads the zip in memory, unpacks it, and builds a single commit through the GitHub Git Data API: blobs, a tree, a commit, and a branch update. Files that used to exist in that folder but are no longer part of the export get removed from the commit as well, so the folder always mirrors the current state of the Snack project.

Before building the commit, the extension scans every `.js`/`.jsx`/`.ts`/`.tsx` file for imports and compares them against `package.json`. Any package that's imported but missing gets added automatically: native modules (things like `react-native-reanimated`, `react-native-svg`, `@react-native-async-storage/async-storage`) are pinned to the exact version range bundled by the project's Expo SDK — the same source `expo install` uses — since Snack can only run native code matching its runtime; pure-JS libraries (like `react-native-paper`) get the newest npm version whose `peerDependencies` on `react`/`react-native` matches what's already pinned in the project. No more opening `package.json` by hand and guessing a version.

A folder browser lets you look at the existing structure of the repository and pick or create a target folder visually instead of typing a path.

A "Criar repositório novo" button in the destination section can create the repository itself (personal account or organization, detected from the owner field) before the first push, using the same GitHub API token.

While editing on snack.expo.dev, holding Tab and pressing S triggers Snack's own built-in Prettier button (the small "Prettier" label in the bottom status bar), so the current file gets formatted without reaching for the mouse.

## Installation

1. Open chrome://extensions and enable Developer mode.
2. Click Load unpacked and select this folder.
3. Open the extension options and paste a GitHub fine-grained personal access token. Set Repository access to All repositories ("This applies to all current and future repositories you own. Also includes public repositories (read-only)."). That is the simplest choice, it covers repos you create later, and it is the only one that lets the "Criar repositório novo" button work, since a repo that does not exist yet cannot be picked from the list. Give the token Contents read and write, plus Administration read and write if you want the create-repo button.

## Usage

1. Open a project on snack.expo.dev.
2. Click Commitar next to Expo Docs, or open the extension icon directly.
3. Pick or download the zip you want to send.
4. Set owner, repository, branch, and folder.
5. Click Commitar in the popup.

## Project structure

manifest.json declares permissions and scripts, pointing at the files below by their folder.

- `background/` — the service worker and everything it drives. `background.js` watches downloads, talks to the popup, and orchestrates the GitHub push (one handler function per message type, routed through a small dispatch table). `github.js` wraps the GitHub Git Data API calls. `deps.js` scans imports and resolves missing `package.json` dependencies (native modules against the Expo SDK's bundled versions, JS-only ones against npm `peerDependencies`). `semver-lite.js` is the small semver range matcher `deps.js` relies on.
- `content/` — `content.js` injects the Commitar button into the Snack page and drives the Tab+S Prettier shortcut; `content.css` holds the styles it injects (registered as a content script stylesheet, not built as a string in JS).
- `popup/` — the main interface. `popup.js` is a thin orchestrator; the actual sections live in their own ES modules: `capture.js` (zip capture/list), `destination.js` (owner/repo/branch, create-repo, open-in-Snack), `folder-browser.js` (the repo folder picker), `push.js` (the commit push + log), `state.js` (draft/history persistence), `format.js` (pure formatting helpers), `dom.js` (shared element lookups + small UI utilities).
- `options/` — `options.html`/`options.css`/`options.js` hold the GitHub token, saved locally in the browser.
- `shared/` — `theme.css` is the base "window chrome" look both popup and options build on (each only overrides the sizes that actually differ between them). `concurrency.js` and `repo-path.js` are small helpers (bounded-concurrency `Promise.all`, subpath sanitization) used from the background service worker.
- `vendor/` — `jszip.min.js`, the only third-party dependency, kept separate from the project's own code.
- `assets/fonts/` — the Poppins font files used by `shared/theme.css`.
