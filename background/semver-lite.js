function svParseVersion(v) {
  if (!v) return null;
  const m = String(v)
    .trim()
    .replace(/^v/, "")
    .match(/^(\d+|x|\*)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?(?:-([0-9A-Za-z.-]+))?/);
  if (!m) return null;
  const part = (p) => (p === undefined || p === "x" || p === "*" ? null : parseInt(p, 10));
  return { major: part(m[1]), minor: part(m[2]), patch: part(m[3]), pre: m[4] || null };
}

function svCmpNum(a, b) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function svComparePrerelease(a, b) {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  const pa = a.split(".");
  const pb = b.split(".");
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const xa = pa[i];
    const xb = pb[i];
    if (xa === undefined) return -1;
    if (xb === undefined) return 1;
    const na = /^\d+$/.test(xa) ? parseInt(xa, 10) : xa;
    const nb = /^\d+$/.test(xb) ? parseInt(xb, 10) : xb;
    if (typeof na === "number" && typeof nb === "number") {
      if (na !== nb) return na < nb ? -1 : 1;
    } else {
      const sa = String(na);
      const sb = String(nb);
      if (sa !== sb) return sa < sb ? -1 : 1;
    }
  }
  return 0;
}

function svCompareVersions(a, b) {
  const pa = svParseVersion(a);
  const pb = svParseVersion(b);
  if (!pa || !pb) return 0;
  const majorCmp = svCmpNum(pa.major || 0, pb.major || 0);
  if (majorCmp) return majorCmp;
  const minorCmp = svCmpNum(pa.minor || 0, pb.minor || 0);
  if (minorCmp) return minorCmp;
  const patchCmp = svCmpNum(pa.patch || 0, pb.patch || 0);
  if (patchCmp) return patchCmp;
  return svComparePrerelease(pa.pre, pb.pre);
}

function svIsStable(v) {
  const p = svParseVersion(v);
  return !!p && !p.pre;
}

function svBoundsFromWildcardExact(v) {
  const p = svParseVersion(v);
  if (!p) return null;
  if (p.major === null) return { gte: "0.0.0", lt: null };
  if (p.minor === null) return { gte: `${p.major}.0.0`, lt: `${p.major + 1}.0.0` };
  if (p.patch === null) return { gte: `${p.major}.${p.minor}.0`, lt: `${p.major}.${p.minor + 1}.0` };
  return { eq: `${p.major}.${p.minor}.${p.patch}${p.pre ? "-" + p.pre : ""}` };
}

function svBoundsFromCaret(v) {
  const p = svParseVersion(v);
  if (!p) return null;
  const major = p.major || 0;
  const minor = p.minor || 0;
  const patch = p.patch || 0;
  let upper;
  if (major > 0) upper = `${major + 1}.0.0`;
  else if (minor > 0) upper = `0.${minor + 1}.0`;
  else upper = `0.0.${patch + 1}`;
  return { gte: `${major}.${minor}.${patch}${p.pre ? "-" + p.pre : ""}`, lt: upper };
}

function svBoundsFromTilde(v) {
  const p = svParseVersion(v);
  if (!p) return null;
  const major = p.major || 0;
  const minor = p.minor === null ? 0 : p.minor;
  const patch = p.patch || 0;
  const upper = p.minor === null ? `${major + 1}.0.0` : `${major}.${minor + 1}.0`;
  return { gte: `${major}.${minor}.${patch}${p.pre ? "-" + p.pre : ""}`, lt: upper };
}

function svSatisfiesComparator(version, comparator) {
  comparator = comparator.trim();
  if (!comparator || comparator === "*" || comparator === "x") return true;

  let m;
  if ((m = comparator.match(/^>=\s*(.+)$/))) return svCompareVersions(version, m[1]) >= 0;
  if ((m = comparator.match(/^<=\s*(.+)$/))) return svCompareVersions(version, m[1]) <= 0;
  if ((m = comparator.match(/^>\s*(.+)$/))) return svCompareVersions(version, m[1]) > 0;
  if ((m = comparator.match(/^<\s*(.+)$/))) return svCompareVersions(version, m[1]) < 0;
  if ((m = comparator.match(/^=\s*(.+)$/))) comparator = m[1];

  if ((m = comparator.match(/^\^(.+)$/))) {
    const b = svBoundsFromCaret(m[1]);
    return svCompareVersions(version, b.gte) >= 0 && svCompareVersions(version, b.lt) < 0;
  }
  if ((m = comparator.match(/^~(.+)$/))) {
    const b = svBoundsFromTilde(m[1]);
    return svCompareVersions(version, b.gte) >= 0 && svCompareVersions(version, b.lt) < 0;
  }

  const b = svBoundsFromWildcardExact(comparator);
  if (!b) return true;
  if (b.eq !== undefined) return svCompareVersions(version, b.eq) === 0;
  const geOk = svCompareVersions(version, b.gte) >= 0;
  const ltOk = b.lt === null ? true : svCompareVersions(version, b.lt) < 0;
  return geOk && ltOk;
}

function svSatisfiesAndClause(version, clause) {
  clause = clause.trim();
  const hyphen = clause.match(/^(.+?)\s+-\s+(.+)$/);
  if (hyphen) {
    return svCompareVersions(version, hyphen[1]) >= 0 && svCompareVersions(version, hyphen[2]) <= 0;
  }
  const comparators = clause.split(/\s+/).filter(Boolean);
  return comparators.every((c) => svSatisfiesComparator(version, c));
}

function svSatisfiesRange(version, range) {
  if (!range || range === "*" || range === "") return true;
  const orClauses = range.split("||");
  return orClauses.some((clause) => svSatisfiesAndClause(version, clause));
}
