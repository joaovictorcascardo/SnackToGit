# SnackToGit

SnackToGit is a Chrome extension that takes a project exported from Expo Snack and commits it straight into a GitHub repository, without downloading a zip, extracting it, and running git commands by hand.

## How it works

A button labeled Commitar is injected into the Snack page next to the Expo Docs link. Clicking it opens the extension popup. Inside the popup you can trigger a fresh export from the active Snack tab, or pick an existing download from the recent list. Once a zip is selected, you choose the destination repository, branch, and an optional folder inside that repository, then confirm.

The extension downloads the zip in memory, unpacks it, and builds a single commit through the GitHub Git Data API: blobs, a tree, a commit, and a branch update. Files that used to exist in that folder but are no longer part of the export get removed from the commit as well, so the folder always mirrors the current state of the Snack project.

A folder browser lets you look at the existing structure of the repository and pick or create a target folder visually instead of typing a path.

## Installation

1. Open chrome://extensions and enable Developer mode.
2. Click Load unpacked and select this folder.
3. Open the extension options and paste a GitHub personal access token with Contents read and write permission for the repositories you plan to use.

## Usage

1. Open a project on snack.expo.dev.
2. Click Commitar next to Expo Docs, or open the extension icon directly.
3. Pick or download the zip you want to send.
4. Set owner, repository, branch, and folder.
5. Click Commitar in the popup.

## Project structure

manifest.json declares permissions and scripts. background.js watches downloads, talks to the popup, and drives the GitHub push. content.js injects the Commitar button into the Snack page. lib/github.js wraps the GitHub Git Data API calls. lib/jszip.min.js reads the zip file in memory. popup.html, popup.css, and popup.js make up the main interface. options.html, options.css, and options.js hold the GitHub token, saved locally in the browser.
