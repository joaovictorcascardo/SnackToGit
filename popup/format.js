export function suggestNextSubpath(lastSubpath) {
  if (!lastSubpath) return "";
  const m = lastSubpath.match(/^(.*?)(\d+)(\D*)$/);
  if (!m) return lastSubpath;
  const [, prefix, num, suffix] = m;
  const nextNum = String(Number(num) + 1).padStart(num.length, "0");
  return prefix + nextNum + suffix;
}

export function defaultCommitMessage(subpath) {
  const label = subpath && subpath.trim() ? subpath.trim() : "projeto";
  return `Snack: ${label}`;
}

export function formatWhen(ts) {
  if (!ts) return "";
  const diffMin = Math.round((Date.now() - ts) / 60000);
  if (diffMin < 1) return "agora";
  if (diffMin < 60) return `${diffMin} min atrás`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `${diffH} h atrás`;
  return new Date(ts).toLocaleDateString("pt-BR");
}
