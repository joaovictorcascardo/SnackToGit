import { els, appendLog } from "./dom.js";
import { formatWhen } from "./format.js";

let currentCapture = null;
let lastZipItems = [];

export function getCurrentCapture() {
  return currentCapture;
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

async function selectZip(item) {
  const capture = { id: item.id, url: item.url, filename: item.filename, time: item.time, state: "complete" };
  await chrome.runtime.sendMessage({ type: "SET_CAPTURE", capture });
  currentCapture = capture;
  renderCapture();
  renderZipList(lastZipItems);
}

async function refreshZipList() {
  lastZipItems = (await chrome.runtime.sendMessage({ type: "LIST_RECENT_ZIPS" })) || [];
  renderZipList(lastZipItems);
}

export async function refreshCapture() {
  currentCapture = await chrome.runtime.sendMessage({ type: "GET_LAST_CAPTURE" });
  renderCapture();
  await refreshZipList();
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

export async function handleDownloadFresh() {
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

export async function refreshNetworkPermission() {
  const granted = await chrome.permissions.contains({ origins: ["<all_urls>"] });
  els.grantNetwork.hidden = granted;
}
