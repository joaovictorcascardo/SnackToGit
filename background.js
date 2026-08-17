importScripts("lib/jszip.min.js", "lib/github.js");

function isZipItem(item) {
  const url = item.finalUrl || item.url || "";
  const byUrl = /\.zip($|\?)/i.test(url);
  const byName = /\.zip$/i.test(item.filename || "");
  return byUrl || byName;
}

async function rememberCapture(item) {
  const capture = {
    id: item.id,
    url: item.finalUrl || item.url,
    filename: item.filename || "",
    time: Date.now(),
    state: item.state
  };
  await chrome.storage.session.set({ lastSnackCapture: capture });
}

chrome.downloads.onCreated.addListener((item) => {
  if (isZipItem(item)) rememberCapture(item);
});

chrome.downloads.onChanged.addListener((delta) => {
  if (!delta.id) return;
  chrome.downloads.search({ id: delta.id }, (items) => {
    const item = items && items[0];
    if (item && isZipItem(item)) rememberCapture(item);
  });
});

const IGNORED_PATH_RE = /(^|\/)(node_modules|\.git|__MACOSX|\.DS_Store)(\/|$)/i;

function stripCommonRoot(paths) {
  if (paths.length === 0) return "";
  const parts0 = paths[0].split("/");
  let prefixLen = 0;
  for (let i = 0; i < parts0.length - 1; i++) {
    const candidate = parts0.slice(0, i + 1).join("/") + "/";
    if (paths.every((p) => p.startsWith(candidate))) {
      prefixLen = candidate.length;
    } else {
      break;
    }
  }
  return paths[0].slice(0, prefixLen);
}

async function zipBufferToFileList(arrayBuffer) {
  const zip = await JSZip.loadAsync(arrayBuffer);
  const entries = [];
  zip.forEach((relPath, entry) => {
    if (entry.dir) return;
    if (IGNORED_PATH_RE.test(relPath)) return;
    entries.push(entry);
  });

  const allPaths = entries.map((e) => e.name);
  const commonRoot = stripCommonRoot(allPaths);

  const files = [];
  for (const entry of entries) {
    const base64 = await entry.async("base64");
    const relPath = commonRoot ? entry.name.slice(commonRoot.length) : entry.name;
    if (!relPath) continue;
    files.push({ path: relPath, base64 });
  }
  return files;
}

function joinRepoPath(subpath, relPath) {
  const clean = (subpath || "").trim().replace(/^\/+|\/+$/g, "");
  return clean ? `${clean}/${relPath}` : relPath;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "GET_LAST_CAPTURE") {
    chrome.storage.session.get("lastSnackCapture", (data) => {
      sendResponse(data.lastSnackCapture || null);
    });
    return true;
  }
  if (msg && msg.type === "CLEAR_CAPTURE") {
    chrome.storage.session.remove("lastSnackCapture", () => sendResponse(true));
    return true;
  }
  if (msg && msg.type === "LIST_RECENT_ZIPS") {
    chrome.downloads.search(
      { orderBy: ["-startTime"], limit: 15 },
      (items) => {
        const zips = (items || [])
          .filter((it) => isZipItem(it) && it.state !== "interrupted")
          .slice(0, 6)
          .map((it) => ({
            id: it.id,
            url: it.finalUrl || it.url,
            filename: it.filename || "",
            time: it.endTime ? Date.parse(it.endTime) : it.startTime ? Date.parse(it.startTime) : Date.now()
          }));
        sendResponse(zips);
      }
    );
    return true;
  }
  if (msg && msg.type === "SET_CAPTURE") {
    chrome.storage.session.set({ lastSnackCapture: msg.capture }, () => sendResponse(true));
    return true;
  }
  if (msg && msg.type === "LIST_REPO_FOLDERS") {
    const { token, owner, repo, branch } = msg.payload;
    listRepoFolders(token, owner, repo, branch || "main")
      .then((res) => sendResponse({ ok: true, ...res }))
      .catch((err) => sendResponse({ ok: false, error: err.message || String(err) }));
    return true;
  }
  if (msg && msg.type === "OPEN_POPUP") {
    chrome.action
      .openPopup()
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "push") return;

  port.onMessage.addListener(async (msg) => {
    if (!msg || msg.type !== "start") return;
    const { zipUrl, token, owner, repo, branch, subpath, commitMessage } = msg.payload;

    const log = (text) => {
      try {
        port.postMessage({ type: "log", text });
      } catch {}
    };

    try {
      log("Baixando zip do Snack...");
      const res = await fetch(zipUrl);
      if (!res.ok) {
        throw new Error(
          `Não consegui baixar o zip (HTTP ${res.status}). Se a permissão de rede ainda não foi concedida, use o botão "Conceder acesso de rede" no popup.`
        );
      }
      const buffer = await res.arrayBuffer();

      log("Descompactando...");
      const files = await zipBufferToFileList(buffer);
      if (files.length === 0) {
        throw new Error("O zip não trouxe nenhum arquivo (depois de ignorar node_modules/.git).");
      }

      const filesWithRepoPath = files.map((f) => ({
        path: joinRepoPath(subpath, f.path),
        base64: f.base64
      }));

      const result = await pushFilesAsCommit(
        {
          token,
          owner,
          repo,
          branch: branch || "main",
          message: commitMessage,
          files: filesWithRepoPath,
          syncPrefix: subpath ? subpath.trim().replace(/^\/+|\/+$/g, "") : ""
        },
        log
      );

      port.postMessage({ type: "done", result });
    } catch (err) {
      port.postMessage({ type: "error", message: err && err.message ? err.message : String(err) });
    }
  });
});
