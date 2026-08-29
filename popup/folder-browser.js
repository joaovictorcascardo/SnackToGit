import { els, appendLog } from "./dom.js";
import { defaultCommitMessage } from "./format.js";
import { saveDraft } from "./state.js";

let allFolders = [];
let allFiles = [];
let pendingFolders = []; // full paths created here, not on GitHub yet
let browsePath = [];
let confirmDeletePath = null;
let ctx = { token: "", owner: "", repo: "", branch: "main" };

const FOLDER_SVG =
  '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 4.3c0-.7.6-1.3 1.3-1.3h3l1.3 1.6h5.1c.7 0 1.3.6 1.3 1.3v6.8c0 .7-.6 1.3-1.3 1.3H3.3C2.6 14 2 13.4 2 12.7V4.3z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>';
const FILE_SVG =
  '<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M4 1.5h5L13 5.5V14a.5.5 0 0 1-.5.5h-9A.5.5 0 0 1 3 14V2a.5.5 0 0 1 .5-.5Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M9 1.7V5.5h3.8" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>';

function knownFolders() {
  return [...new Set([...allFolders, ...pendingFolders])];
}

function countFilesUnder(fullPath) {
  const prefix = fullPath + "/";
  return allFiles.filter((f) => f.startsWith(prefix)).length;
}

// A folder that isn't in the repo tree and holds no files: "creating" and
// "deleting" it are local-only, no commit.
function isLocalOnly(full) {
  return !allFolders.includes(full) && countFilesUnder(full) === 0;
}

function folderChildren(pathSegments) {
  const prefix = pathSegments.length ? pathSegments.join("/") + "/" : "";
  const seen = new Set();
  const children = [];
  for (const f of knownFolders()) {
    if (prefix && !f.startsWith(prefix)) continue;
    const rest = prefix ? f.slice(prefix.length) : f;
    const parts = rest.split("/");
    if (!parts[0]) continue;
    const full = pathSegments.concat(parts[0]).join("/");
    if (seen.has(full)) continue;
    seen.add(full);
    children.push({ name: parts[0], full, local: isLocalOnly(full) });
  }
  return children.sort((a, b) => a.name.localeCompare(b.name));
}

function fileChildren(pathSegments) {
  const prefix = pathSegments.length ? pathSegments.join("/") + "/" : "";
  const out = [];
  for (const f of allFiles) {
    if (prefix && !f.startsWith(prefix)) continue;
    const rest = prefix ? f.slice(prefix.length) : f;
    if (!rest || rest.includes("/")) continue;
    out.push({ name: rest, full: f });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function renderBreadcrumb() {
  els.folderBreadcrumb.innerHTML = "";
  const rootBtn = document.createElement("button");
  rootBtn.type = "button";
  rootBtn.textContent = "raiz";
  rootBtn.className = browsePath.length === 0 ? "current" : "";
  rootBtn.addEventListener("click", () => {
    browsePath = [];
    confirmDeletePath = null;
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
      confirmDeletePath = null;
      renderFolderBrowser();
    });
    els.folderBreadcrumb.appendChild(btn);
  });
}

function renderConfirmBar() {
  const bar = document.createElement("div");
  bar.className = "folder-confirm";
  const n = countFilesUnder(confirmDeletePath);
  const msg = document.createElement("p");
  msg.textContent = `Apagar "${confirmDeletePath}/" e ${n} arquivo(s) num commit? Não dá pra desfazer.`;
  const row = document.createElement("div");
  row.className = "folder-confirm-actions";

  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "btn-flat";
  cancel.textContent = "Cancelar";
  cancel.addEventListener("click", () => {
    confirmDeletePath = null;
    renderFolderBrowser();
  });

  const del = document.createElement("button");
  del.type = "button";
  del.className = "btn-flat folder-confirm-del";
  del.textContent = "Apagar num commit";
  del.addEventListener("click", runConfirmedDelete);

  row.append(cancel, del);
  bar.append(msg, row);
  return bar;
}

function renderFolderBrowser() {
  renderBreadcrumb();
  els.folderList.innerHTML = "";

  if (confirmDeletePath) els.folderList.appendChild(renderConfirmBar());

  const folders = folderChildren(browsePath);
  const files = fileChildren(browsePath);

  if (folders.length === 0 && files.length === 0 && !confirmDeletePath) {
    const p = document.createElement("p");
    p.className = "empty-hint";
    p.textContent = "Nada aqui ainda.";
    els.folderList.appendChild(p);
  }

  for (const child of folders) {
    const row = document.createElement("div");
    row.className = "folder-row";

    const open = document.createElement("button");
    open.type = "button";
    open.className = "folder-open";
    open.innerHTML = FOLDER_SVG + "<span></span>";
    open.querySelector("span").textContent = child.name;
    if (child.local) {
      const tag = document.createElement("em");
      tag.className = "folder-tag";
      tag.textContent = "nova";
      open.appendChild(tag);
    }
    open.addEventListener("click", () => {
      browsePath = browsePath.concat(child.name);
      confirmDeletePath = null;
      renderFolderBrowser();
    });

    const del = document.createElement("button");
    del.type = "button";
    del.className = "folder-del";
    del.title = "Apagar pasta";
    del.textContent = "×";
    del.addEventListener("click", (ev) => {
      ev.stopPropagation();
      deleteFolder(child.full);
    });

    row.append(open, del);
    els.folderList.appendChild(row);
  }

  for (const file of files) {
    const link = document.createElement("a");
    link.className = "folder-file";
    link.target = "_blank";
    link.rel = "noopener";
    const seg = (s) => s.split("/").map(encodeURIComponent).join("/");
    link.href =
      `https://github.com/${encodeURIComponent(ctx.owner)}/${encodeURIComponent(ctx.repo)}` +
      `/blob/${seg(ctx.branch)}/${seg(file.full)}`;
    link.innerHTML = FILE_SVG + "<span></span>";
    link.querySelector("span").textContent = file.name;
    els.folderList.appendChild(link);
  }
}

function deleteFolder(full) {
  if (isLocalOnly(full)) {
    pendingFolders = pendingFolders.filter((p) => p !== full && !p.startsWith(full + "/"));
    if (browsePath.join("/") === full || browsePath.join("/").startsWith(full + "/")) {
      browsePath = full.includes("/") ? full.split("/").slice(0, -1) : [];
    }
    renderFolderBrowser();
    return;
  }
  confirmDeletePath = full;
  renderFolderBrowser();
}

async function runConfirmedDelete() {
  const full = confirmDeletePath;
  els.folderStatus.textContent = `Apagando ${full}/ ...`;
  const res = await chrome.runtime.sendMessage({
    type: "DELETE_REPO_FOLDER",
    payload: { token: ctx.token, owner: ctx.owner, repo: ctx.repo, branch: ctx.branch, folder: full }
  });
  confirmDeletePath = null;

  if (!res || !res.ok) {
    els.folderStatus.textContent = "Erro ao apagar: " + (res && res.error ? res.error : "desconhecido");
    renderFolderBrowser();
    return;
  }

  if (browsePath.join("/") === full || browsePath.join("/").startsWith(full + "/")) {
    browsePath = full.includes("/") ? full.split("/").slice(0, -1) : [];
  }
  await loadFolders();
  els.folderStatus.textContent = res.removed
    ? `Pasta apagada (${res.removed} arquivo(s), commit ${String(res.commitSha).slice(0, 7)}).`
    : "A pasta já estava vazia.";
}

function addNewFolder() {
  const name = els.newFolderName.value.trim().replace(/[\\/]+/g, "");
  if (!name || name === "." || name === "..") return;
  const full = browsePath.concat(name).join("/");
  if (!pendingFolders.includes(full)) pendingFolders.push(full);
  browsePath = browsePath.concat(name);
  els.newFolderName.value = "";
  confirmDeletePath = null;
  renderFolderBrowser();
}

async function loadFolders() {
  els.folderStatus.textContent = "Carregando pastas do repositório...";
  els.folderList.innerHTML = "";
  renderBreadcrumb();

  const res = await chrome.runtime.sendMessage({
    type: "LIST_REPO_FOLDERS",
    payload: { token: ctx.token, owner: ctx.owner, repo: ctx.repo, branch: ctx.branch }
  });

  if (!res || !res.ok) {
    els.folderStatus.textContent = "Erro ao carregar pastas: " + (res && res.error ? res.error : "desconhecido");
    allFolders = [];
    allFiles = [];
    renderFolderBrowser();
    return;
  }

  allFolders = res.folders || [];
  allFiles = res.files || [];
  els.folderStatus.textContent = res.truncated
    ? "Repositório grande demais, lista pode estar incompleta."
    : "";
  renderFolderBrowser();
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

  ctx = { token: githubToken, owner, repo, branch };
  pendingFolders = [];
  confirmDeletePath = null;
  allFolders = [];
  allFiles = [];

  const typed = els.subpath.value
    .trim()
    .split("/")
    .filter((s) => s && s !== "." && s !== "..");
  browsePath = typed;
  if (typed.length) pendingFolders.push(typed.join("/"));

  els.overlay.hidden = false;
  await loadFolders();
}

function closeFolderBrowser() {
  els.overlay.hidden = true;
  els.newFolderName.value = "";
  pendingFolders = [];
  confirmDeletePath = null;
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
