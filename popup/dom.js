export const $ = (id) => document.getElementById(id);

export const els = {
  captureDot: $("capture-dot"),
  captureText: $("capture-text"),
  grantNetwork: $("grant-network"),
  tokenDot: $("token-dot"),
  tokenText: $("token-text"),
  openOptions: $("open-options"),
  owner: $("owner"),
  repo: $("repo"),
  branch: $("branch"),
  subpath: $("subpath"),
  subpathHistory: $("subpath-history"),
  commitMessage: $("commit-message"),
  downloadFresh: $("download-fresh"),
  zipList: $("zip-list"),
  zipToggle: $("zip-toggle"),
  zipBody: $("zip-body"),
  destinoToggle: $("destino-toggle"),
  destinoBody: $("destino-body"),
  createRepoToggle: $("create-repo-toggle"),
  createRepoPanel: $("create-repo-panel"),
  newRepoDesc: $("new-repo-desc"),
  newRepoPublic: $("new-repo-public"),
  newRepoCancel: $("new-repo-cancel"),
  newRepoCreate: $("new-repo-create"),
  newRepoStatus: $("new-repo-status"),
  browseFolders: $("browse-folders"),
  overlay: $("folder-overlay"),
  folderBreadcrumb: $("folder-breadcrumb"),
  folderStatus: $("folder-status"),
  folderList: $("folder-list"),
  newFolderName: $("new-folder-name"),
  newFolderAdd: $("new-folder-add"),
  folderCancel: $("folder-cancel"),
  folderUse: $("folder-use"),
  push: $("push"),
  logSection: $("log-section"),
  log: $("log"),
  result: $("result")
};

export function setupCollapsible(toggleEl, bodyEl, storageKey) {
  const apply = (collapsed) => {
    bodyEl.hidden = collapsed;
    toggleEl.classList.toggle("collapsed", collapsed);
  };
  chrome.storage.local.get(storageKey, (data) => apply(!!data[storageKey]));
  toggleEl.addEventListener("click", async () => {
    const collapsed = !bodyEl.hidden;
    apply(collapsed);
    await chrome.storage.local.set({ [storageKey]: collapsed });
  });
}

export function appendLog(text, isError) {
  els.logSection.hidden = false;
  const line = document.createElement("div");
  if (isError) line.className = "error-text";
  line.textContent = text;
  els.log.appendChild(line);
  els.log.scrollTop = els.log.scrollHeight;
}
