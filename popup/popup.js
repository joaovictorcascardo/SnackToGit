import { els, setupCollapsible } from "./dom.js";
import { loadState, scheduleDraftSave } from "./state.js";
import { refreshCapture, handleDownloadFresh, refreshNetworkPermission } from "./capture.js";
import { renderToken, initDestination } from "./destination.js";
import { initFolderBrowser } from "./folder-browser.js";
import { handlePush } from "./push.js";

setupCollapsible(els.zipToggle, els.zipBody, "zipCollapsed");
setupCollapsible(els.destinoToggle, els.destinoBody, "destinoCollapsed");

initDestination();
initFolderBrowser();

els.recheckCapture.addEventListener("click", refreshCapture);
els.downloadFresh.addEventListener("click", handleDownloadFresh);
els.grantNetwork.addEventListener("click", async () => {
  const granted = await chrome.permissions.request({ origins: ["<all_urls>"] });
  els.grantNetwork.hidden = granted;
});
els.openOptions.addEventListener("click", () => chrome.runtime.openOptionsPage());
els.push.addEventListener("click", handlePush);

for (const field of [els.owner, els.repo, els.branch, els.subpath, els.commitMessage]) {
  field.addEventListener("input", scheduleDraftSave);
}

async function init() {
  const { githubToken } = await loadState();
  renderToken(githubToken);
  await refreshCapture();
  await refreshNetworkPermission();
}

init();
