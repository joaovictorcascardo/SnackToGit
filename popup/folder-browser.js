import { els, appendLog } from "./dom.js";
import { defaultCommitMessage } from "./format.js";
import { saveDraft } from "./state.js";

let allFolders = [];
let browsePath = [];

function folderChildren(pathSegments) {
  const prefix = pathSegments.length ? pathSegments.join("/") + "/" : "";
  const seen = new Set();
  const children = [];
  for (const f of allFolders) {
    if (prefix && !f.startsWith(prefix)) continue;
    const rest = prefix ? f.slice(prefix.length) : f;
    const parts = rest.split("/");
    if (parts.length !== 1 || !parts[0]) continue;
    const full = pathSegments.concat(parts[0]).join("/");
    if (!seen.has(full)) {
      seen.add(full);
      children.push({ name: parts[0], full });
    }
  }
  return children.sort((a, b) => a.name.localeCompare(b.name));
}

function renderBreadcrumb() {
  els.folderBreadcrumb.innerHTML = "";
  const rootBtn = document.createElement("button");
  rootBtn.type = "button";
  rootBtn.textContent = "raiz";
  rootBtn.className = browsePath.length === 0 ? "current" : "";
  rootBtn.addEventListener("click", () => {
    browsePath = [];
    renderFolderBrowser();
  });
  els.folderBreadcrumb.appendChild(rootBtn);

  browsePath.forEach((seg, i) => {
    const sep = document.createElement("span");
    sep.className = "sep";
    sep.textContent = "/";
    els.folderBreadcrumb.appendChild(sep);

    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = seg;
    btn.className = i === browsePath.length - 1 ? "current" : "";
    btn.addEventListener("click", () => {
      browsePath = browsePath.slice(0, i + 1);
      renderFolderBrowser();
    });
    els.folderBreadcrumb.appendChild(btn);
  });
}

function renderFolderBrowser() {
  renderBreadcrumb();
  els.folderList.innerHTML = "";
  const children = folderChildren(browsePath);
  if (children.length === 0) {
    const p = document.createElement("p");
    p.className = "empty-hint";
    p.textContent = "Nenhuma subpasta aqui ainda.";
    els.folderList.appendChild(p);
  }
  for (const child of children) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "folder-row";
    row.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 4.3c0-.7.6-1.3 1.3-1.3h3l1.3 1.6h5.1c.7 0 1.3.6 1.3 1.3v6.8c0 .7-.6 1.3-1.3 1.3H3.3C2.6 14 2 13.4 2 12.7V4.3z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg><span></span>';
    row.querySelector("span").textContent = child.name;
    row.addEventListener("click", () => {
      browsePath = browsePath.concat(child.name);
      renderFolderBrowser();
    });
    els.folderList.appendChild(row);
  }
}

async function openFolderBrowser() {
  const owner = els.owner.value.trim();
  const repo = els.repo.value.trim();
  const branch = els.branch.value.trim() || "main";
  const { githubToken } = await chrome.storage.local.get("githubToken");

  if (!githubToken || !owner || !repo) {
    appendLog("Preencha dono, repositório e token antes de escolher a pasta pelo navegador.", true);
    return;
  }

  browsePath = els.subpath.value.trim() ? els.subpath.value.trim().split("/") : [];
  els.overlay.hidden = false;
  els.folderStatus.textContent = "Carregando pastas do repositório...";
  els.folderList.innerHTML = "";
  renderBreadcrumb();

  const res = await chrome.runtime.sendMessage({
    type: "LIST_REPO_FOLDERS",
    payload: { token: githubToken, owner, repo, branch }
  });

  if (!res || !res.ok) {
    els.folderStatus.textContent = "Erro ao carregar pastas: " + (res && res.error ? res.error : "desconhecido");
    allFolders = [];
    browsePath = [];
    renderFolderBrowser();
    return;
  }

  allFolders = res.folders || [];
  els.folderStatus.textContent = res.truncated ? "Repositório grande demais, lista pode estar incompleta." : "";
  if (!allFolders.some((f) => f === browsePath.join("/"))) {
    browsePath = [];
  }
  renderFolderBrowser();
}

function closeFolderBrowser() {
  els.overlay.hidden = true;
  els.newFolderName.value = "";
}

function addNewFolder() {
  const name = els.newFolderName.value.trim().replace(/\/+/g, "");
  if (!name) return;
  browsePath = browsePath.concat(name);
  els.newFolderName.value = "";
  renderFolderBrowser();
}

export function initFolderBrowser() {
  els.browseFolders.addEventListener("click", openFolderBrowser);
  els.folderCancel.addEventListener("click", closeFolderBrowser);
  els.folderUse.addEventListener("click", () => {
    const path = browsePath.join("/");
    els.subpath.value = path;
    if (!els.commitMessage.value.trim() || els.commitMessage.value === defaultCommitMessage("")) {
      els.commitMessage.value = defaultCommitMessage(path);
    }
    saveDraft();
    closeFolderBrowser();
  });
  els.newFolderAdd.addEventListener("click", addNewFolder);
  els.newFolderName.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      addNewFolder();
    }
  });
}
