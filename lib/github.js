const GITHUB_API = "https://api.github.com";

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

async function getRepo(token, owner, repo) {
  return ghRequest(token, "GET", `/repos/${owner}/${repo}`);
}

async function getRef(token, owner, repo, branch) {
  try {
    return await ghRequest(token, "GET", `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`);
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}

async function getCommit(token, owner, repo, sha) {
  return ghRequest(token, "GET", `/repos/${owner}/${repo}/git/commits/${sha}`);
}

async function createBlob(token, owner, repo, base64Content) {
  const res = await ghRequest(token, "POST", `/repos/${owner}/${repo}/git/blobs`, {
    content: base64Content,
    encoding: "base64"
  });
  return res.sha;
}

async function getTreeRecursive(token, owner, repo, treeSha) {
  const res = await ghRequest(token, "GET", `/repos/${owner}/${repo}/git/trees/${treeSha}?recursive=1`);
  return res;
}

async function createTree(token, owner, repo, baseTreeSha, entries) {
  const res = await ghRequest(token, "POST", `/repos/${owner}/${repo}/git/trees`, {
    base_tree: baseTreeSha || undefined,
    tree: entries
  });
  return res.sha;
}

async function createCommit(token, owner, repo, message, treeSha, parentSha) {
  const res = await ghRequest(token, "POST", `/repos/${owner}/${repo}/git/commits`, {
    message,
    tree: treeSha,
    parents: parentSha ? [parentSha] : []
  });
  return res.sha;
}

async function upsertRef(token, owner, repo, branch, commitSha, hasParent) {
  if (hasParent) {
    await ghRequest(token, "PATCH", `/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, {
      sha: commitSha,
      force: false
    });
  } else {
    await ghRequest(token, "POST", `/repos/${owner}/${repo}/git/refs`, {
      ref: `refs/heads/${branch}`,
      sha: commitSha
    });
  }
}

async function listRepoFolders(token, owner, repo, branch) {
  await getRepo(token, owner, repo);
  const ref = await getRef(token, owner, repo, branch);
  if (!ref) {
    return { folders: [], truncated: false };
  }
  const commit = await getCommit(token, owner, repo, ref.object.sha);
  const tree = await getTreeRecursive(token, owner, repo, commit.tree.sha);
  const folders = (tree.tree || []).filter((e) => e.type === "tree").map((e) => e.path);
  return { folders, truncated: !!tree.truncated };
}

async function pushFilesAsCommit({ token, owner, repo, branch, message, files, syncPrefix }, onLog) {
  const log = onLog || (() => {});

  log(`Verificando repositório ${owner}/${repo}...`);
  await getRepo(token, owner, repo);

  log(`Enviando ${files.length} arquivo(s)...`);
  const baseEntries = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const sha = await createBlob(token, owner, repo, f.base64);
    baseEntries.push({ path: f.path, mode: "100644", type: "blob", sha });
    if (files.length > 6 && (i + 1) % 5 === 0) {
      log(`  ...${i + 1}/${files.length}`);
    }
  }
  const newPaths = new Set(files.map((f) => f.path));

  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    log(`Lendo estado atual da branch "${branch}"...`);
    const ref = await getRef(token, owner, repo, branch);
    let baseTreeSha = null;
    let parentSha = null;
    const hasParent = !!ref;
    if (ref) {
      parentSha = ref.object.sha;
      const commit = await getCommit(token, owner, repo, parentSha);
      baseTreeSha = commit.tree.sha;
    }

    const entries = [...baseEntries];
    if (baseTreeSha && syncPrefix) {
      const prefix = syncPrefix.endsWith("/") ? syncPrefix : syncPrefix + "/";
      const existingTree = await getTreeRecursive(token, owner, repo, baseTreeSha);
      if (existingTree.truncated) {
        log("Aviso: a árvore do repo é grande demais e a listagem veio incompleta; arquivos apagados na pasta podem não ser detectados desta vez.");
      }
      const stale = (existingTree.tree || []).filter(
        (e) => e.type === "blob" && e.path.startsWith(prefix) && !newPaths.has(e.path)
      );
      if (stale.length > 0) {
        log(`Removendo ${stale.length} arquivo(s) que não existem mais no Snack...`);
        for (const e of stale) {
          entries.push({ path: e.path, mode: "100644", type: "blob", sha: null });
        }
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
