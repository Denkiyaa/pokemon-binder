// api/utils/slug.js
export function toSlug(s = '') {
  return (s || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 200);
}

export function masterSlug({ set_name, collector_number, name }) {
  const parts = [
    toSlug(set_name || 'unknown'),
    toSlug(collector_number || 'x'),
    toSlug(name || 'card')
  ];
  return parts.filter(Boolean).join('_');
}
