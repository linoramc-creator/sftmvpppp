/** Display-only user metadata. Never use a name to grant account privileges. */
export function normalizeProfileName(value: unknown): string {
  if (typeof value !== 'string' || value.length > 200 || /[\p{Cc}\p{Cf}]/u.test(value)) return '';
  const name = value.normalize('NFC').trim().replace(/\s+/gu, ' ');
  if (!name || Array.from(name).length > 60 || !/\p{L}/u.test(name)) return '';
  return /^[\p{L}\p{M}\p{N} .'’·-]+$/u.test(name) ? name : '';
}

export function profileDisplayName(metadata: unknown, email: unknown): string {
  const data = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? metadata as Record<string, unknown> : {};
  const actual = normalizeProfileName(data.display_name) || normalizeProfileName(data.full_name);
  if (actual) return actual;
  if (typeof email !== 'string') return '';
  // Existing accounts may have no name. Keep their recognizable account alias.
  const alias = email.split('@')[0].replace(/[._+-]+/g, ' ').replace(/[^\p{L}\p{M}\p{N} ]/gu, '').trim();
  return normalizeProfileName(Array.from(alias).slice(0, 60).join(''));
}
