const IMPORT_FROM_RE = /\bimport\s+[^'";]*?\bfrom\s*["']([^"']+)["']/g;
const IMPORT_BARE_RE = /\bimport\s*["']([^"']+)["']/g;
const EXPORT_FROM_RE = /\bexport\s+[^'";]*?\bfrom\s*["']([^"']+)["']/g;
const REQUIRE_RE = /\brequire\(\s*["']([^"']+)["']\s*\)/g;
const DYNAMIC_IMPORT_RE = /\bimport\(\s*["']([^"']+)["']\s*\)/g;
const SOURCE_FILE_RE = /\.(jsx?|tsx?|mjs|cjs)$/i;

function depsBase64ToUtf8(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function depsUtf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function packageNameFromSpecifier(spec) {
  if (!spec || spec.startsWith(".") || spec.startsWith("/")) return null;
  const parts = spec.split("/");
  if (spec.startsWith("@")) return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : null;
  return parts[0];
}

function scanImportedPackages(files) {
  const names = new Set();
  for (const f of files) {
    if (!SOURCE_FILE_RE.test(f.path)) continue;
    let text;
    try {
      text = depsBase64ToUtf8(f.base64);
    } catch {
      continue;
    }
    for (const re of [IMPORT_FROM_RE, IMPORT_BARE_RE, EXPORT_FROM_RE, REQUIRE_RE, DYNAMIC_IMPORT_RE]) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text))) {
        const name = packageNameFromSpecifier(m[1]);
        if (name) names.add(name);
      }
    }
  }
  return [...names];
}

function parsePackageJson(files) {
  const entry = files.find((f) => f.path === "package.json");
  if (!entry) return null;
  try {
    return JSON.parse(depsBase64ToUtf8(entry.base64));
  } catch {
    return null;
  }
}

function depBaselineVersion(pkgData, name) {
  const v = (pkgData.dependencies && pkgData.dependencies[name]) || (pkgData.devDependencies && pkgData.devDependencies[name]);
  if (!v) return null;
  const m = String(v).match(/(\d+\.\d+\.\d+)/);
  return m ? m[1] : null;
}

function getExpoSdkMajor(pkgData) {
  const v = (pkgData.dependencies && pkgData.dependencies.expo) || (pkgData.devDependencies && pkgData.devDependencies.expo);
  if (!v) return null;
  const m = String(v).match(/(\d+)/);
  return m ? m[1] : null;
}

async function fetchBundledNativeModules(sdkMajor) {
  if (!sdkMajor) return null;
  try {
    const res = await fetch(`https://raw.githubusercontent.com/expo/expo/sdk-${sdkMajor}/packages/expo/bundledNativeModules.json`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function fetchNpmMetadata(pkgName) {
  const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(pkgName)}`);
  if (!res.ok) return null;
  return res.json();
}

function resolveCompatibleNpmVersion(meta, baselineReact, baselineRN) {
  const latest = meta["dist-tags"] && meta["dist-tags"].latest;
  const versions = Object.keys(meta.versions || {});
  const stable = versions.filter(svIsStable).sort((a, b) => svCompareVersions(b, a));
  const candidates = stable.slice(0, 60);
  for (const v of candidates) {
    const peers = (meta.versions[v] && meta.versions[v].peerDependencies) || {};
    let ok = true;
    if (baselineReact && peers.react && !svSatisfiesRange(baselineReact, peers.react)) ok = false;
    if (baselineRN && peers["react-native"] && !svSatisfiesRange(baselineRN, peers["react-native"])) ok = false;
    if (ok) return { version: v, matched: true };
  }
  return { version: latest || null, matched: false };
}

async function resolveMissingDependencies(missingNames, pkgData, log) {
  const result = {};
  if (missingNames.length === 0) return result;

  const sdkMajor = getExpoSdkMajor(pkgData);
  log(sdkMajor ? `Detectado Expo SDK ${sdkMajor}.` : "Não achei a versão do SDK do Expo no package.json.");

  const bundled = await fetchBundledNativeModules(sdkMajor);
  if (sdkMajor && !bundled) {
    log("Aviso: não consegui consultar a lista de módulos nativos do Expo; vou resolver tudo pela última versão compatível do npm.");
  }

  const baselineReact = depBaselineVersion(pkgData, "react");
  const baselineRN = depBaselineVersion(pkgData, "react-native");

  for (const name of missingNames) {
    if (bundled && Object.prototype.hasOwnProperty.call(bundled, name)) {
      result[name] = bundled[name];
      log(`  ${name}@${bundled[name]} — módulo nativo embutido no Expo SDK ${sdkMajor}`);
      continue;
    }
    try {
      const meta = await fetchNpmMetadata(name);
      if (!meta) {
        log(`  ${name}: não achei no npm, pulei — adicione a mão se precisar.`);
        continue;
      }
      const { version, matched } = resolveCompatibleNpmVersion(meta, baselineReact, baselineRN);
      if (!version) {
        log(`  ${name}: não consegui resolver uma versão, pulei.`);
        continue;
      }
      result[name] = version;
      log(
        matched
          ? `  ${name}@${version} — compatível com o react/react-native do projeto`
          : `  ${name}@${version} — última versão do npm (sem peerDependencies pra conferir)`
      );
    } catch (err) {
      log(`  ${name}: erro ao consultar o npm (${err.message || err}), pulei.`);
    }
  }
  return result;
}

function applyMissingDependencies(files, versions) {
  if (Object.keys(versions).length === 0) return files;
  const idx = files.findIndex((f) => f.path === "package.json");
  if (idx === -1) return files;

  let pkgData;
  try {
    pkgData = JSON.parse(depsBase64ToUtf8(files[idx].base64));
  } catch {
    return files;
  }

  pkgData.dependencies = pkgData.dependencies || {};
  for (const [name, version] of Object.entries(versions)) {
    pkgData.dependencies[name] = version;
  }

  const updated = [...files];
  updated[idx] = { path: "package.json", base64: depsUtf8ToBase64(JSON.stringify(pkgData, null, 2) + "\n") };
  return updated;
}
