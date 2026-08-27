importScripts(
  "../vendor/jszip.min.js",
  "../shared/concurrency.js",
  "../shared/repo-path.js",
  "github.js",
  "semver-lite.js",
  "deps.js"
);

const UNZIP_CONCURRENCY = 8;

function isZipItem(item) {
  const url = item.finalUrl || item.url || "";
  const byUrl = /\.zip($|\?)/i.test(url);
  const byName = /\.zip$/i.test(item.filename || "");
  if (!byUrl && !byName) return false;

  return /(^|\.)(snack\.expo\.dev|expo\.dev|exp\.host|expo\.io)$/i.test(
    safeHostname(item.referrer)
  );
}

function safeHostname(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

async function rememberCapture(item) {
  const capture = {
    id: item.id,
    // Keep the original download URL (api.expo.dev/v2/snack/download/...), not
    // finalUrl: finalUrl is the storage URL it redirected to, and that one is
    // signed and expires, so an older entry can no longer be re-fetched.
    url: item.url || item.finalUrl,
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

  const withPaths = entries
    .map((entry) => ({
      entry,
      relPath: commonRoot ? entry.name.slice(commonRoot.length) : entry.name
    }))
    .filter((e) => e.relPath);

  return mapConcurrent(withPaths, UNZIP_CONCURRENCY, async ({ entry, relPath }) => ({
    path: relPath,
    base64: await entry.async("base64")
  }));
}

function handleGetLastCapture(_payload, sendResponse) {
  chrome.storage.session.get("lastSnackCapture", (data) => {
    sendResponse(data.lastSnackCapture || null);
  });
}

function handleClearCapture(_payload, sendResponse) {
  chrome.storage.session.remove("lastSnackCapture", () => sendResponse(true));
}

function handleListRecentZips(_payload, sendResponse) {
  chrome.downloads.search({ orderBy: ["-startTime"], limit: 15 }, (items) => {
    const zips = (items || [])
      .filter((it) => isZipItem(it) && it.state !== "interrupted")
      .slice(0, 6)
      .map((it) => ({
        id: it.id,
        // original URL, not the expiring signed finalUrl (see rememberCapture)
        url: it.url || it.finalUrl,
        filename: it.filename || "",
        time: it.endTime ? Date.parse(it.endTime) : it.startTime ? Date.parse(it.startTime) : Date.now()
      }));
    sendResponse(zips);
  });
}

function handleSetCapture(payload, sendResponse) {
  chrome.storage.session.set({ lastSnackCapture: payload.capture }, () => sendResponse(true));
}

function handleCreateRepo(payload, sendResponse) {
  const { token, owner, repo, description, isPrivate } = payload;
  createRepo(token, { owner, name: repo, description, isPrivate })
    .then((res) => sendResponse({ ok: true, ...res }))
    .catch((err) => sendResponse({ ok: false, error: err.message || String(err) }));
}

function handleListRepoFolders(payload, sendResponse) {
  const { token, owner, repo, branch } = payload;
  listRepoFolders(token, owner, repo, branch || "main")
    .then((res) => sendResponse({ ok: true, ...res }))
    .catch((err) => sendResponse({ ok: false, error: err.message || String(err) }));
}

function handleOpenPopup(_payload, sendResponse) {
  chrome.action
    .openPopup()
    .then(() => sendResponse({ ok: true }))
    .catch((err) => sendResponse({ ok: false, error: String(err) }));
}

const MESSAGE_HANDLERS = {
  GET_LAST_CAPTURE: handleGetLastCapture,
  CLEAR_CAPTURE: handleClearCapture,
  LIST_RECENT_ZIPS: handleListRecentZips,
  SET_CAPTURE: handleSetCapture,
  CREATE_REPO: handleCreateRepo,
  LIST_REPO_FOLDERS: handleListRepoFolders,
  OPEN_POPUP: handleOpenPopup
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handler = msg && MESSAGE_HANDLERS[msg.type];
  if (!handler) return;
  handler(msg.payload, sendResponse);
  return true;
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

      log("Verificando dependências que faltam no package.json...");
      let filesToPush = files;
      const pkgData = parsePackageJson(files);
      if (pkgData) {
        const known = new Set([
          ...Object.keys(pkgData.dependencies || {}),
          ...Object.keys(pkgData.devDependencies || {})
        ]);
        const missing = scanImportedPackages(files).filter((name) => !known.has(name));
        if (missing.length > 0) {
          log(`Pacote(s) importado(s) mas ausente(s) do package.json: ${missing.join(", ")}`);
          const versions = await resolveMissingDependencies(missing, pkgData, log);
          filesToPush = applyMissingDependencies(files, versions);
        } else {
          log("Nenhuma dependência faltando.");
        }
      } else {
        log("Aviso: não achei package.json no zip, pulei a checagem de dependências.");
      }

      const filesWithRepoPath = filesToPush.map((f) => ({
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
          syncPrefix: sanitizeRepoSubpath(subpath)
        },
        log
      );

      port.postMessage({ type: "done", result });
    } catch (err) {
      port.postMessage({ type: "error", message: err && err.message ? err.message : String(err) });
    }
  });
});
