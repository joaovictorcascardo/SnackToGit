import { els } from "./dom.js";
import { suggestNextSubpath, defaultCommitMessage } from "./format.js";

let history = [];
let draftSaveTimer = null;

function currentFormValues() {
  return {
    owner: els.owner.value.trim(),
    repo: els.repo.value.trim(),
    branch: els.branch.value.trim(),
    subpath: els.subpath.value.trim(),
    commitMessage: els.commitMessage.value
  };
}

export function applyFormValues(form) {
  els.owner.value = form.owner || "";
  els.repo.value = form.repo || "";
  els.branch.value = form.branch || "main";
  els.subpath.value = form.subpath || "";
  els.commitMessage.value = form.commitMessage || defaultCommitMessage(form.subpath);
}

export function saveDraft() {
  chrome.storage.local.set({ draftForm: currentFormValues() });
}

export function scheduleDraftSave() {
  clearTimeout(draftSaveTimer);
  draftSaveTimer = setTimeout(saveDraft, 300);
}

function renderSubpathHistory() {
  const subpaths = [...new Set(history.map((h) => h.subpath).filter(Boolean))];
  els.subpathHistory.innerHTML = "";
  for (const s of subpaths) {
    const opt = document.createElement("option");
    opt.value = s;
    els.subpathHistory.appendChild(opt);
  }
}

export async function loadState() {
  const { githubToken, defaultRepo, history: storedHistory, draftForm } = await chrome.storage.local.get([
    "githubToken",
    "defaultRepo",
    "history",
    "draftForm"
  ]);
  history = storedHistory || [];
  renderSubpathHistory();

  if (draftForm) {
    applyFormValues(draftForm);
    return { githubToken };
  }

  const repo = defaultRepo || {};
  const lastForRepo = history.find((h) => h.owner === repo.owner && h.repo === repo.repo);
  const suggestion = suggestNextSubpath(lastForRepo && lastForRepo.subpath);
  applyFormValues({
    owner: repo.owner || "",
    repo: repo.repo || "",
    branch: repo.branch || "main",
    subpath: suggestion,
    commitMessage: defaultCommitMessage(suggestion)
  });
  return { githubToken };
}

export async function saveAfterPush(owner, repo, branch, subpath) {
  await chrome.storage.local.set({ defaultRepo: { owner, repo, branch } });
  const entry = { owner, repo, branch, subpath, time: Date.now() };
  history = history.filter((h) => !(h.owner === owner && h.repo === repo && h.subpath === subpath));
  history.unshift(entry);
  history = history.slice(0, 10);
  await chrome.storage.local.set({ history });
  renderSubpathHistory();

  const nextSubpath = suggestNextSubpath(subpath);
  applyFormValues({
    owner,
    repo,
    branch,
    subpath: nextSubpath,
    commitMessage: defaultCommitMessage(nextSubpath)
  });
  saveDraft();
}
