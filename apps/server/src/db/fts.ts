/**
 * Converts free text into a safe FTS5 query: quoted phrases are kept, other words become prefix terms joined by OR
 * so that partial matches still rank.
 */
export function toFtsQuery(input: string): string {
  const phrases: string[] = [];
  const rest = input.replace(/"([^"]+)"/g, (_m, p: string) => {
    const words = p.match(/[\p{L}\p{N}]+/gu);
    if (words?.length) phrases.push(`"${words.join(' ')}"`);
    return ' ';
  });
  const words = (rest.match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => w.length > 1).map((w) => `${w}*`);
  const terms = [...phrases, ...words];
  return terms.join(' OR ');
}
