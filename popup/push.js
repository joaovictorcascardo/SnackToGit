import { els, appendLog } from "./dom.js";
import { defaultCommitMessage } from "./format.js";
import { getCurrentCapture } from "./capture.js";
import { saveAfterPush } from "./state.js";

function setBusy(busy) {
  els.push.disabled = busy;
  els.push.textContent = busy ? "Commitando..." : "Commitar";
}

function renderResult(commitSha, htmlUrl, owner, repo, branch, subpath) {
  els.result.innerHTML = "";
  els.result.append("Commit: ");

  const commitLink = document.createElement("a");
  commitLink.href = htmlUrl;
  commitLink.target = "_blank";
  commitLink.rel = "noopener";
  commitLink.textContent = commitSha.slice(0, 7);
  els.result.append(commitLink, " — ");

  const treePath = [owner, repo, "tree", branch, ...(subpath ? subpath.split("/") : [])]
    .map(encodeURIComponent)
    .join("/");
  const treeLink = document.createElement("a");
  treeLink.href = `https://github.com/${treePath}`;
  treeLink.target = "_blank";
  treeLink.rel = "noopener";
  treeLink.textContent = "ver pasta no GitHub";
  els.result.append(treeLink);

  els.result.hidden = false;
}

export async function handlePush() {
  els.result.hidden = true;
  els.log.innerHTML = "";
  els.logSection.hidden = true;

  const { githubToken } = await chrome.storage.local.get("githubToken");
  if (!githubToken) {
    appendLog('Configure o token do GitHub primeiro (botão "Configurar token").', true);
    return;
  }
  const currentCapture = getCurrentCapture();
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
      renderResult(msg.result.commitSha, msg.result.htmlUrl, owner, repo, branch, subpath);
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
