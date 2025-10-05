// api/utils/img-candidate.js
const SIZE_ORDER = [1600, 1200, 1000, 800, 600, 480, 400, 360, 320, 300, 240, 180, 120, 90, 60];
const WIDTH_ORDER = [1600, 1200, 1000, 800, 600, 480];

const buildWithSize = (pathPart, suffix, size, ext) => `${pathPart}/${size}${ext}${suffix}`;

export function candidatesForHigher(u = '') {
  if (!u) return [];

  const seen = new Set();
  const out = [];
  const push = (value) => {
    if (!value || seen.has(value)) return;
    seen.add(value);
    out.push(value);
  };

  const [pathOnly, queryPart = ''] = u.split('?');
  const querySuffix = queryPart ? `?${queryPart}` : '';
  const sizeMatch = pathOnly.match(/\/(\d+)(\.(?:jpg|png))$/i);

  if (sizeMatch) {
    const [, , ext] = sizeMatch;
    const prefix = pathOnly.slice(0, -sizeMatch[0].length);
    for (const target of SIZE_ORDER) {
      push(buildWithSize(prefix, querySuffix, target, ext));
    }
  }

  if (/([?&])w=\d+/i.test(u)) {
    for (const width of WIDTH_ORDER) {
      push(u.replace(/([?&])w=\d+/gi, `$1w=${width}`));
    }
  }

  push(u);
  return out;
}
