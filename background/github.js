const GITHUB_API = "https://api.github.com";
const BLOB_UPLOAD_CONCURRENCY = 6;

async function gitBlobSha1(base64Content) {
  const binary = atob(base64Content);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const header = new TextEncoder().encode(`blob ${bytes.length}\0`);
  const full = new Uint8Array(header.length + bytes.length);
  full.set(header, 0);
  full.set(bytes, header.length);
  const digest = await crypto.subtle.digest("SHA-1", full);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function ghRequest(token, method, path, body) {
  const res = await fetch(GITHUB_API + path, {
    method,
    headers: {
      Authorization: "Bearer " + token,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });

  let data = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }

  if (!res.ok) {
    const msg = (data && (data.message || data.error)) || res.statusText;
    const err = new Error(`GitHub API ${method} ${path} -> ${res.status}: ${msg}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function repoPath(owner, repo) {
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

async function getRepo(token, owner, repo) {
  return ghRequest(token, "GET", repoPath(owner, repo));
}

async function getAuthenticatedUser(token) {
  return ghRequest(token, "GET", "/user");
}

async function createRepo(token, { owner, name, description, isPrivate }) {
  const me = await getAuthenticatedUser(token);
  const isPersonal = !!me.login && me.login.toLowerCase() === (owner || "").trim().toLowerCase();

  const body = { name, private: !!isPrivate, auto_init: false };
  if (description) body.description = description;

  const path = isPersonal ? "/user/repos" : `/orgs/${encodeURIComponent(owner)}/repos`;
  const res = await ghRequest(token, "POST", path, body);
  return {
    fullName: res.full_name,
    htmlUrl: res.html_url,
    defaultBranch: res.default_branch || "main"
  };
}

async function getRef(token, owner, repo, branch) {
  try {
    return await ghRequest(token, "GET", `${repoPath(owner, repo)}/git/ref/heads/${encodeURIComponent(branch)}`);
  } catch (err) {
    if (err.status === 404 || err.status === 409) return null;
    throw err;
  }
}

async function getCommit(token, owner, repo, sha) {
  return ghRequest(token, "GET", `${repoPath(owner, repo)}/git/commits/${sha}`);
}

async function createBlob(token, owner, repo, base64Content) {
  const res = await ghRequest(token, "POST", `${repoPath(owner, repo)}/git/blobs`, {
    content: base64Content,
    encoding: "base64"
  });
  return res.sha;
}

function isEmptyRepoError(err) {
  return err.status === 409 && /empty/i.test((err.data && err.data.message) || "");
}

async function bootstrapEmptyRepo(token, owner, repo, branch, file) {
  const encodedPath = file.path.split("/").map(encodeURIComponent).join("/");
  await ghRequest(token, "PUT", `${repoPath(owner, repo)}/contents/${encodedPath}`, {
    message: "Inicializa o repositório",
    content: file.base64,
    branch
  });
}

async function getTreeRecursive(token, owner, repo, treeSha) {
  const res = await ghRequest(token, "GET", `${repoPath(owner, repo)}/git/trees/${treeSha}?recursive=1`);
  return res;
}

async function createTree(token, owner, repo, baseTreeSha, entries) {
  const res = await ghRequest(token, "POST", `${repoPath(owner, repo)}/git/trees`, {
    base_tree: baseTreeSha || undefined,
    tree: entries
  });
  return res.sha;
}

async function createCommit(token, owner, repo, message, treeSha, parentSha) {
  const res = await ghRequest(token, "POST", `${repoPath(owner, repo)}/git/commits`, {
    message,
    tree: treeSha,
    parents: parentSha ? [parentSha] : []
  });
  return res.sha;
}

async function upsertRef(token, owner, repo, branch, commitSha, hasParent) {
  if (hasParent) {
    await ghRequest(token, "PATCH", `${repoPath(owner, repo)}/git/refs/heads/${encodeURIComponent(branch)}`, {
      sha: commitSha,
      force: false
    });
  } else {
    await ghRequest(token, "POST", `${repoPath(owner, repo)}/git/refs`, {
      ref: `refs/heads/${branch}`,
      sha: commitSha
    });
  }
}

async function listRepoFolders(token, owner, repo, branch) {
  await getRepo(token, owner, repo);
  const ref = await getRef(token, owner, repo, branch);
  if (!ref) {
    return { folders: [], files: [], truncated: false };
  }
  const commit = await getCommit(token, owner, repo, ref.object.sha);
  const tree = await getTreeRecursive(token, owner, repo, commit.tree.sha);
  const entries = tree.tree || [];
  const folders = entries.filter((e) => e.type === "tree").map((e) => e.path);
  const files = entries.filter((e) => e.type === "blob").map((e) => e.path);
  return { folders, files, truncated: !!tree.truncated };
}

async function readBranchState(token, owner, repo, branch) {
  const ref = await getRef(token, owner, repo, branch);
  if (!ref) {
    return { ref: null, parentSha: null, baseTreeSha: null, tree: [], truncated: false };
  }
  const parentSha = ref.object.sha;
  const commit = await getCommit(token, owner, repo, parentSha);
  const baseTreeSha = commit.tree.sha;
  const existingTree = await getTreeRecursive(token, owner, repo, baseTreeSha);
  return { ref, parentSha, baseTreeSha, tree: existingTree.tree || [], truncated: !!existingTree.truncated };
}

// Files under `prefix` that the incoming Snack export no longer contains, as
// tree entries that delete them. With no prefix (pushing to the repo root) this
// returns nothing on purpose: there is no "folder" to mirror, so we never delete
// unrelated files that already live in the repo.
function computeStaleDeletions(tree, newPaths, prefix) {
  if (!prefix) return [];
  return tree
    .filter((e) => e.type === "blob" && e.path.startsWith(prefix) && !newPaths.has(e.path))
    .map((e) => ({ path: e.path, mode: "100644", type: "blob", sha: null }));
}

async function pushFilesAsCommit({ token, owner, repo, branch, message, files, syncPrefix }, onLog) {
  const log = onLog || (() => {});

  log(`Verificando repositório ${owner}/${repo}...`);
  await getRepo(token, owner, repo);

  log(`Lendo estado atual da branch "${branch}"...`);
  let state = await readBranchState(token, owner, repo, branch);
  if (state.truncated) {
    log("Aviso: a árvore do repo é grande demais e a listagem veio incompleta; arquivos apagados na pasta podem não ser detectados desta vez.");
  }

  const existingShaByPath = new Map(state.tree.filter((e) => e.type === "blob").map((e) => [e.path, e.sha]));

  log(`Conferindo ${files.length} arquivo(s)...`);
  let uploaded = 0;
  let unchanged = 0;
  let bootstrapPromise = null;
  async function createBlobResilient(f) {
    try {
      return await createBlob(token, owner, repo, f.base64);
    } catch (err) {
      if (!isEmptyRepoError(err)) throw err;
      if (!bootstrapPromise) {
        log("Repositório ainda não tem nenhum commit — criando o primeiro arquivo pra destravar...");
        bootstrapPromise = bootstrapEmptyRepo(token, owner, repo, branch, files[0]);
      }
      await bootstrapPromise;
      return createBlob(token, owner, repo, f.base64);
    }
  }

  const baseEntries = await mapConcurrent(files, BLOB_UPLOAD_CONCURRENCY, async (f) => {
    const localSha = await gitBlobSha1(f.base64);
    if (existingShaByPath.get(f.path) === localSha) {
      unchanged++;
      return { path: f.path, mode: "100644", type: "blob", sha: localSha };
    }
    const sha = await createBlobResilient(f);
    uploaded++;
    if (files.length > 6 && uploaded % 5 === 0) {
      log(`  ...${uploaded} enviado(s)`);
    }
    return { path: f.path, mode: "100644", type: "blob", sha };
  });
  log(
    unchanged > 0
      ? `${uploaded} arquivo(s) novo(s)/modificado(s) enviado(s), ${unchanged} sem mudança (não reenviado).`
      : `${uploaded} arquivo(s) enviado(s).`
  );

  if (bootstrapPromise) {
    log(`Relendo estado da branch "${branch}" depois de inicializar o repositório...`);
    state = await readBranchState(token, owner, repo, branch);
  }

  const newPaths = new Set(files.map((f) => f.path));
  const prefix = syncPrefix ? (syncPrefix.endsWith("/") ? syncPrefix : syncPrefix + "/") : "";
  if (!prefix) {
    log("Sem pasta de destino: os arquivos do Snack vão pra raiz e nada que já existe no repo é removido.");
  }

  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (attempt > 1) {
      log(`Lendo estado atual da branch "${branch}" de novo...`);
      state = await readBranchState(token, owner, repo, branch);
    }
    const { ref, parentSha, baseTreeSha, tree } = state;
    const hasParent = !!ref;

    const entries = [...baseEntries];
    if (baseTreeSha) {
      const stale = computeStaleDeletions(tree, newPaths, prefix);
      if (stale.length > 0) {
        log(`Removendo ${stale.length} arquivo(s) que não existem mais no Snack...`);
        entries.push(...stale);
      }
    }

    log("Criando árvore de arquivos...");
    const treeSha = await createTree(token, owner, repo, baseTreeSha, entries);

    log("Criando commit...");
    const commitSha = await createCommit(token, owner, repo, message, treeSha, parentSha);

    log(`Atualizando branch "${branch}"...`);
    try {
      await upsertRef(token, owner, repo, branch, commitSha, hasParent);
      return {
        commitSha,
        htmlUrl: `https://github.com/${owner}/${repo}/commit/${commitSha}`
      };
    } catch (err) {
      const isRaceCondition = err.status === 422 || err.status === 409;
      if (isRaceCondition && attempt < maxAttempts) {
        log(`A branch "${branch}" mudou enquanto eu montava o commit. Tentando de novo (${attempt}/${maxAttempts})...`);
        continue;
      }
      throw err;
    }
  }
}

// Delete a folder (every blob under `folder/`) from the branch in one commit.
async function deleteRepoFolder(token, owner, repo, branch, folder) {
  const clean = String(folder || "")
    .split("/")
    .map((s) => s.trim())
    .filter((s) => s && s !== "." && s !== "..")
    .join("/");
  if (!clean) throw new Error("Pasta inválida.");
  const prefix = clean + "/";

  let state = await readBranchState(token, owner, repo, branch);
  if (!state.ref) throw new Error(`Branch "${branch}" não encontrada.`);

  for (let attempt = 1; attempt <= 3; attempt++) {
    if (attempt > 1) state = await readBranchState(token, owner, repo, branch);
    const stale = computeStaleDeletions(state.tree, new Set(), prefix);
    if (stale.length === 0) return { removed: 0, commitSha: null };

    const treeSha = await createTree(token, owner, repo, state.baseTreeSha, stale);
    const commitSha = await createCommit(token, owner, repo, `Remove ${prefix}`, treeSha, state.parentSha);
    try {
      await upsertRef(token, owner, repo, branch, commitSha, true);
      return { removed: stale.length, commitSha };
    } catch (err) {
      if ((err.status === 422 || err.status === 409) && attempt < 3) continue;
      throw err;
    }
  }
}
