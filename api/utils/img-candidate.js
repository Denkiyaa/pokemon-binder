// api/utils/img-candidate.js
export function candidatesForHigher(u = '') {
  if (!u) return [];
  const list = [u];
  const add = v => { if (v && !list.includes(v)) list.push(v); };

  if (/\/60\.(jpg|png)/i.test(u))  { add(u.replace('/60.', '/180.')); add(u.replace('/60.', '/300.')); add(u.replace('/60.', '/600.')); add(u.replace('/60.', '/1000.')); }
  if (/\/180\.(jpg|png)/i.test(u)) { add(u.replace('/180.', '/300.')); add(u.replace('/180.', '/600.')); add(u.replace('/180.', '/1000.')); }
  if (/\/300\.(jpg|png)/i.test(u)) { add(u.replace('/300.', '/600.')); add(u.replace('/300.', '/1000.')); }
  if (/\/600\.(jpg|png)/i.test(u)) { add(u.replace('/600.', '/1000.')); }

  if (/\bw=\d+/.test(u)) {
    add(u.replace(/([?&])w=\d+/, '$1w=480'));
    add(u.replace(/([?&])w=\d+/, '$1w=800'));
  }
  return list;
}
