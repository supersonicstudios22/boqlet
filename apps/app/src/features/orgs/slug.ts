/** Letters NFKD does not split into a base letter and a mark. */
const LETTERS: Record<string, string> = { đ: "dj", ð: "d", ß: "ss", ø: "o", æ: "ae", œ: "oe", ł: "l", þ: "th", ı: "i" };

/**
 * The org's address suggested from its name (F01 §4): lower-case `a-z0-9-`, 3–40 characters. A name
 * with no letter a–z or digit suggests nothing (review C-29: no "000"); the person chooses one.
 */
export function suggestSlug(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[đðßøæœłþı]/g, (ch) => LETTERS[ch] ?? ch)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  if (!base) return "";
  return base.length >= 3 ? base : base.padEnd(3, "0");
}

export const SLUG_PATTERN = /^[a-z0-9-]{3,40}$/;
