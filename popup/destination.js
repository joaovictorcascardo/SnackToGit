import { els } from "./dom.js";
import { saveDraft, scheduleDraftSave } from "./state.js";
import { defaultReadme } from "./format.js";
import { handlePush } from "./push.js";

let readmeTouched = false;

export function renderToken(token) {
  const has = !!token;
  els.tokenDot.className = has ? "dot dot-on" : "dot dot-off";
  els.tokenText.textContent = has ? "Token configurado." : "Token não configurado.";
}

function setRepoStatus(text, isError) {
  els.newRepoStatus.textContent = text;
  els.newRepoStatus.classList.toggle("is-error", !!isError);
}

function firstCommitMode() {
  const checked = document.querySelector('input[name="first-commit"]:checked');
  return checked ? checked.value : "both";
}

function applyModeUi() {
  els.newRepoReadmeField.hidden = firstCommitMode() === "files";
}

function refreshReadmeDraft() {
  if (!readmeTouched) els.newRepoReadme.value = defaultReadme(els.repo.value);
}

function openCreateRepoPanel() {
  setRepoStatus("", false);
  els.newRepoName.value = els.repo.value;
  readmeTouched = !!els.newRepoReadme.value.trim();
  refreshReadmeDraft();
  applyModeUi();
  els.createRepoPanel.hidden = false;
}

function closeCreateRepoPanel() {
  els.createRepoPanel.hidden = true;
  els.newRepoDesc.value = "";
  setRepoStatus("", false);
}

async function handleCreateRepo() {
  const owner = els.owner.value.trim();
  const repo = els.repo.value.trim();
  if (!owner || !repo) {
    setRepoStatus("Preencha Dono e Repositório acima antes de criar.", true);
    return;
  }

  const { githubToken } = await chrome.storage.local.get("githubToken");
  if (!githubToken) {
    setRepoStatus('Configure o token do GitHub primeiro ("Configurar token").', true);
    return;
  }

  const mode = firstCommitMode();
  const readme = mode === "files" ? null : els.newRepoReadme.value;

  els.newRepoCreate.disabled = true;
  setRepoStatus("Criando repositório...", false);

  const res = await chrome.runtime.sendMessage({
    type: "CREATE_REPO",
    payload: {
      token: githubToken,
      owner,
      repo,
      description: els.newRepoDesc.value.trim(),
      isPrivate: !els.newRepoPublic.checked,
      readme
    }
  });

  els.newRepoCreate.disabled = false;

  if (!res || !res.ok) {
    setRepoStatus("Erro ao criar: " + (res && res.error ? res.error : "desconhecido"), true);
    return;
  }

  els.branch.value = res.defaultBranch || "main";
  saveDraft();

  if (mode === "both") {
    setRepoStatus(`Repositório ${res.fullName} criado. Enviando os arquivos do Snack...`, false);
    closeCreateRepoPanel();
    await handlePush();
    return;
  }

  const done = mode === "readme" ? `Repositório ${res.fullName} criado com README.` : `Repositório ${res.fullName} criado.`;
  setRepoStatus(done, false);
  setTimeout(closeCreateRepoPanel, 1400);
}

export function initDestination() {
  els.createRepoToggle.addEventListener("click", () => {
    if (els.createRepoPanel.hidden) openCreateRepoPanel();
    else closeCreateRepoPanel();
  });
  els.newRepoCancel.addEventListener("click", closeCreateRepoPanel);
  els.newRepoCreate.addEventListener("click", handleCreateRepo);

  // The panel's name field and the "Repositório" field above mirror each other.
  els.newRepoName.addEventListener("input", () => {
    els.repo.value = els.newRepoName.value;
    refreshReadmeDraft();
    scheduleDraftSave();
  });
  els.repo.addEventListener("input", () => {
    if (!els.createRepoPanel.hidden) els.newRepoName.value = els.repo.value;
  });

  els.newRepoReadme.addEventListener("input", () => {
    readmeTouched = true;
  });
  for (const radio of document.querySelectorAll('input[name="first-commit"]')) {
    radio.addEventListener("change", applyModeUi);
  }
}
