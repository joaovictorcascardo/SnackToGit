import { els } from "./dom.js";
import { saveDraft } from "./state.js";

export function renderToken(token) {
  const has = !!token;
  els.tokenDot.className = has ? "dot dot-on" : "dot dot-off";
  els.tokenText.textContent = has ? "Token configurado." : "Token não configurado.";
}

function setRepoStatus(text, isError) {
  els.newRepoStatus.textContent = text;
  els.newRepoStatus.classList.toggle("is-error", !!isError);
}

function openCreateRepoPanel() {
  setRepoStatus("", false);
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

  els.newRepoCreate.disabled = true;
  setRepoStatus("Criando repositório...", false);

  const res = await chrome.runtime.sendMessage({
    type: "CREATE_REPO",
    payload: {
      token: githubToken,
      owner,
      repo,
      description: els.newRepoDesc.value.trim(),
      isPrivate: !els.newRepoPublic.checked
    }
  });

  els.newRepoCreate.disabled = false;

  if (!res || !res.ok) {
    setRepoStatus("Erro ao criar: " + (res && res.error ? res.error : "desconhecido"), true);
    return;
  }

  els.branch.value = res.defaultBranch || "main";
  setRepoStatus(`Repositório ${res.fullName} criado.`, false);
  saveDraft();
  setTimeout(closeCreateRepoPanel, 1400);
}

export function initDestination() {
  els.createRepoToggle.addEventListener("click", () => {
    if (els.createRepoPanel.hidden) openCreateRepoPanel();
    else closeCreateRepoPanel();
  });
  els.newRepoCancel.addEventListener("click", closeCreateRepoPanel);
  els.newRepoCreate.addEventListener("click", handleCreateRepo);
}
