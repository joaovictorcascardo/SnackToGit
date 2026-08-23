function sanitizeRepoSubpath(subpath) {
  return (subpath || "")
    .trim()
    .split("/")
    .filter((seg) => seg && seg !== "." && seg !== "..")
    .join("/");
}

function joinRepoPath(subpath, relPath) {
  const clean = sanitizeRepoSubpath(subpath);
  return clean ? `${clean}/${relPath}` : relPath;
}
