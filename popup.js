const $ = (id) => document.getElementById(id);

const els = {
  captureDot: $("capture-dot"),
  captureText: $("capture-text"),
  recheckCapture: $("recheck-capture"),
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
  push: $("push"),
  logSection: $("log-section"),
  log: $("log"),
  result: $("result")
};

let currentCapture = null;
let history = [];
let draftSaveTimer = null;

function suggestNextSubpath(lastSubpath) {
  if (!lastSubpath) return "";
  const m = lastSubpath.match(/^(.*?)(\d+)(\D*)$/);
  if (!m) return lastSubpath;
  const [, prefix, num, suffix] = m;
  const nextNum = String(Number(num) + 1).padStart(num.length, "0");
  return prefix + nextNum + suffix;
}

function defaultCommitMessage(subpath) {
  const label = subpath && subpath.trim() ? subpath.trim() : "projeto";
  return `Snack: ${label}`;
}

function formatWhen(ts) {
  if (!ts) return "";
  const diffMin = Math.round((Date.now() - ts) / 60000);
  if (diffMin < 1) return "agora";
  if (diffMin < 60) return `${diffMin} min atrás`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `${diffH} h atrás`;
  return new Date(ts).toLocaleDateString("pt-BR");
}

function currentFormValues() {
  return {
    owner: els.owner.value.trim(),
    repo: els.repo.value.trim(),
    branch: els.branch.value.trim(),
    subpath: els.subpath.value.trim(),
    commitMessage: els.commitMessage.value
  };
}

function applyFormValues(form) {
  els.owner.value = form.owner || "";
  els.repo.value = form.repo || "";
  els.branch.value = form.branch || "main";
  els.subpath.value = form.subpath || "";
  els.commitMessage.value = form.commitMessage || defaultCommitMessage(form.subpath);
}

function saveDraft() {
  chrome.storage.local.set({ draftForm: currentFormValues() });
}

function scheduleDraftSave() {
  clearTimeout(draftSaveTimer);
  draftSaveTimer = setTimeout(saveDraft, 300);
}

function renderCapture() {
  if (currentCapture && currentCapture.state !== "interrupted") {
    els.captureDot.className = "dot dot-on";
    const name = currentCapture.filename ? currentCapture.filename.split(/[\\/]/).pop() : currentCapture.url;
    els.captureText.textContent = `${name} (${formatWhen(currentCapture.time)})`;
  } else {
    els.captureDot.className = "dot dot-off";
    els.captureText.textContent = "Nenhum zip detectado ainda.";
  }
}

async function refreshCapture() {
  currentCapture = await chrome.runtime.sendMessage({ type: "GET_LAST_CAPTURE" });
  renderCapture();
  await refreshZipList();
}

async function selectZip(item) {
  const capture = { id: item.id, url: item.url, filename: item.filename, time: item.time, state: "complete" };
  await chrome.runtime.sendMessage({ type: "SET_CAPTURE", capture });
  currentCapture = capture;
  renderCapture();
  renderZipList(lastZipItems);
}

let lastZipItems = [];

async function refreshZipList() {
  lastZipItems = (await chrome.runtime.sendMessage({ type: "LIST_RECENT_ZIPS" })) || [];
  renderZipList(lastZipItems);
}

function renderZipList(items) {
  els.zipList.innerHTML = "";
  if (!items || items.length === 0) {
    const p = document.createElement("p");
    p.className = "empty-hint";
    p.textContent = "Nenhum .zip nos downloads recentes.";
    els.zipList.appendChild(p);
    return;
  }
  for (const item of items) {
    const btn = document.createElement("button");
    btn.type = "button";
    const isSelected =
      currentCapture &&
      (currentCapture.id != null ? currentCapture.id === item.id : currentCapture.url === item.url);
    btn.className = "zip-item" + (isSelected ? " selected" : "");
    const name = (item.filename || "").split(/[\\/]/).pop() || item.url;
    btn.innerHTML = `${name}<span class="zip-time">${formatWhen(item.time)}</span>`;
    btn.addEventListener("click", () => selectZip(item));
    els.zipList.appendChild(btn);
  }
}

function waitForFreshCapture(timeoutMs) {
  const start = Date.now();
  return new Promise((resolve) => {
    const tick = () => {
      chrome.runtime.sendMessage({ type: "GET_LAST_CAPTURE" }, (capture) => {
        if (capture) {
          resolve(capture);
          return;
        }
        if (Date.now() - start > timeoutMs) {
          resolve(null);
          return;
        }
        setTimeout(tick, 200);
      });
    };
    tick();
  });
}

async function handleDownloadFresh() {
  els.downloadFresh.disabled = true;
  const label = els.downloadFresh.querySelector("span");
  const originalLabel = label.textContent;
  label.textContent = "Baixando...";

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url || !tab.url.includes("snack.expo.dev")) {
    appendLog("Abra uma aba do snack.expo.dev primeiro.", true);
    els.downloadFresh.disabled = false;
    label.textContent = originalLabel;
    return;
  }

  await chrome.runtime.sendMessage({ type: "CLEAR_CAPTURE" });

  chrome.tabs.sendMessage(tab.id, { type: "TRIGGER_DOWNLOAD" }, async (res) => {
    if (chrome.runtime.lastError || !res || !res.ok) {
      appendLog(
        "Não encontrei o botão de download nessa aba. Verifique se um projeto do Snack está aberto.",
        true
      );
      els.downloadFresh.disabled = false;
      label.textContent = originalLabel;
      return;
    }

    const capture = await waitForFreshCapture(8000);
    els.downloadFresh.disabled = false;
    label.textContent = originalLabel;

    if (!capture) {
      appendLog("Não consegui confirmar o download.", true);
      return;
    }

    await refreshCapture();
  });
}

async function refreshNetworkPermission() {
  const granted = await chrome.permissions.contains({ origins: ["<all_urls>"] });
  els.grantNetwork.hidden = granted;
}

function renderToken(token) {
  const has = !!token;
  els.tokenDot.className = has ? "dot dot-on" : "dot dot-off";
  els.tokenText.textContent = has ? "Token configurado." : "Token não configurado.";
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

async function loadState() {
  const { githubToken, defaultRepo, history: storedHistory, draftForm } = await chrome.storage.local.get([
    "githubToken",
    "defaultRepo",
    "history",
    "draftForm"
  ]);
  renderToken(githubToken);
  history = storedHistory || [];
  renderSubpathHistory();

  if (draftForm) {
    applyFormValues(draftForm);
    return;
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
}

function setBusy(busy) {
  els.push.disabled = busy;
  els.push.textContent = busy ? "Commitando..." : "Commitar";
}

function appendLog(text, isError) {
  els.logSection.hidden = false;
  const line = document.createElement("div");
  if (isError) line.className = "error-text";
  line.textContent = text;
  els.log.appendChild(line);
  els.log.scrollTop = els.log.scrollHeight;
}

async function saveAfterPush(owner, repo, branch, subpath) {
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

async function handlePush() {
  els.result.hidden = true;
  els.log.innerHTML = "";
  els.logSection.hidden = true;

  const { githubToken } = await chrome.storage.local.get("githubToken");
  if (!githubToken) {
    appendLog("Configure o token do GitHub primeiro (botão \"Configurar token\").", true);
    return;
  }
  if (!currentCapture || !currentCapture.url) {
    appendLog("Nenhum zip do Snack detectado. Baixe o projeto no Snack primeiro.", true);
    return;
  }
  const owner = els.owner.value.trim();
  const repo = els.repo.value.trim();
  const branch = els.branch.value.trim() || "main";
  const subpath = els.subpath.value.trim();
  const commitMessage = els.commitMessage.value.trim() || defaultCommitMessage(subpath);
  if (!owner || !repo) {
    appendLog("Preencha dono e repositório.", true);
    return;
  }

  setBusy(true);
  const port = chrome.runtime.connect({ name: "push" });

  port.onMessage.addListener(async (msg) => {
    if (msg.type === "log") {
      appendLog(msg.text, false);
    } else if (msg.type === "done") {
      appendLog("Concluído.");
      els.result.hidden = false;
      const treeUrl = `https://github.com/${owner}/${repo}/tree/${branch}${subpath ? "/" + subpath : ""}`;
      els.result.innerHTML = `Commit: <a href="${msg.result.htmlUrl}" target="_blank" rel="noopener">${msg.result.commitSha.slice(
        0,
        7
      )}</a> — <a href="${treeUrl}" target="_blank" rel="noopener">ver pasta no GitHub</a>`;
      await saveAfterPush(owner, repo, branch, subpath);
      setBusy(false);
    } else if (msg.type === "error") {
      appendLog("Erro: " + msg.message, true);
      setBusy(false);
    }
  });

  port.postMessage({
    type: "start",
    payload: {
      zipUrl: currentCapture.url,
      token: githubToken,
      owner,
      repo,
      branch,
      subpath,
      commitMessage
    }
  });
}

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

loadState();
refreshCapture();
refreshNetworkPermission();
