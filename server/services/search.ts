export const MAX_QUERY = 100;
export const MAX_RESULTS = 10;

/** Trim, cap at 100 chars, and escape LIKE wildcards so the text matches literally. */
export function likePattern(q: string): string {
  const s = Array.from(q.trim()).slice(0, MAX_QUERY).join('');
  return `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
