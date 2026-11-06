export interface SearchEntry {
  slug: string;
  name: string;
  description: string;
  category: string;
  aliases: string[];
}

const BANGLA_DIGITS = "০১২৩৪৫৬৭৮৯";

// Words that mean the same thing for finding a tool, mapped to one shared word.
const SYNONYMS: Record<string, string[]> = {
  merge: ["combine", "join", "merger", "unite", "concatenate", "append", "jukto"],
  split: ["separate", "divide", "splitter", "break", "ভাগ"],
  extract: ["pull", "copy", "take"],
  organize: ["organise", "rearrange", "reorder", "arrange", "sort", "order", "move"],
  rotate: ["turn", "flip", "spin", "sideways", "upside"],
  remove: ["delete", "erase", "drop", "discard"],
  watermark: ["stamp", "confidential", "draft"],
  number: ["numbering", "numbers", "paginate", "pagination"],
  page: ["pages", "sheet"],
  image: ["photo", "picture", "pic", "img", "ছবি", "chobi", "foto", "png", "scan"],
  jpg: ["jpeg"],
  pdf: ["পিডিএফ"],
};

// Ignored when matching, but kept for phrase order, so "pdf to jpg" differs from "jpg to pdf".
const STOP_WORDS = new Set(
  "a an the to for of my in on at and or with from into by is am i it this that your me থেকে কে এর ও".split(" "),
);

// Counted when they match, but not required, because most tools don't use these words.
const SOFT_WORDS = new Set(
  "convert converter conversion change make maker create creator generate generator online free best easy fast quick tool tools app file files how new calculator calculate checker".split(
    " ",
  ),
);

const FIELD_WEIGHTS = { name: 10, aliases: 6, category: 3, description: 1.5 };
const NAME_PHRASE_BONUS = 8;
const ALIAS_PHRASE_BONUS = 6;
const NAME_COVERAGE_BONUS = 3;
const CORRECTED_PENALTY = 0.85;

const canonical = new Map<string, string>();
for (const [word, synonyms] of Object.entries(SYNONYMS)) {
  for (const synonym of synonyms) canonical.set(synonym, word);
}

export function normalize(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[০-৯]/g, (digit) => String(BANGLA_DIGITS.indexOf(digit)))
    .replace(/(\p{N})(\p{L})/gu, "$1 $2")
    .replace(/(\p{L})(\p{N})/gu, "$1 $2")
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, " ")
    .trim();
}

function stem(token: string): string {
  return /^[a-z]{3,}[^s]s$/.test(token) ? token.slice(0, -1) : token;
}

function tokenize(text: string): string[] {
  const normalized = normalize(text);
  return normalized ? normalized.split(" ").map(stem) : [];
}

const canon = (token: string) => canonical.get(token) ?? token;

// Optimal string alignment distance: edits, with swapped neighbours counting as one.
function distance(a: string, b: string): number {
  const rows = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) rows[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 1);
      }
    }
  }
  return rows[a.length][b.length];
}

function allowedTypos(token: string): number {
  if (token.length >= 7) return 2;
  if (token.length >= 4) return 1;
  return 0;
}

interface Field {
  weight: number;
  raw: string[];
  canonical: string[];
}

interface IndexedEntry {
  entry: SearchEntry;
  order: number;
  fields: Field[];
  nameTokens: string[];
  namePhrase: string;
  aliasPhrases: string[];
}

function field(text: string, weight: number): Field {
  const raw = tokenize(text);
  return { weight, raw, canonical: raw.map(canon) };
}

const phrase = (text: string) => tokenize(text).map(canon).join(" ");

interface QueryToken {
  raw: string;
  canonical: string;
  corrected: boolean;
  required: boolean;
}

function matchScore(token: QueryToken, target: Field): number {
  let best = 0;
  for (let i = 0; i < target.raw.length; i++) {
    const raw = target.raw[i];
    const value = target.canonical[i];
    if (value === token.canonical || raw === token.raw) return 1;
    if (token.raw.length >= 2 && (raw.startsWith(token.raw) || value.startsWith(token.canonical))) best = Math.max(best, 0.75);
    else if (token.raw.length >= 4 && raw.includes(token.raw)) best = Math.max(best, 0.4);
  }
  return best;
}

export function createSearch(entries: SearchEntry[]) {
  const indexed: IndexedEntry[] = entries.map((entry, order) => ({
    entry,
    order,
    fields: [
      field(entry.name, FIELD_WEIGHTS.name),
      field(entry.aliases.join(" "), FIELD_WEIGHTS.aliases),
      field(entry.category, FIELD_WEIGHTS.category),
      field(entry.description, FIELD_WEIGHTS.description),
    ],
    nameTokens: tokenize(entry.name).map(canon),
    namePhrase: phrase(entry.name),
    aliasPhrases: entry.aliases.map(phrase),
  }));

  const vocabulary = new Set<string>(canonical.keys());
  for (const item of indexed) {
    for (const f of item.fields) f.raw.forEach((token) => vocabulary.add(token));
  }

  function correct(token: string): { token: string; corrected: boolean } {
    if (vocabulary.has(token)) return { token, corrected: false };
    for (const word of vocabulary) if (word.startsWith(token)) return { token, corrected: false };
    const allowed = allowedTypos(token);
    let best: string | undefined;
    let bestDistance = allowed + 1;
    for (const word of vocabulary) {
      if (Math.abs(word.length - token.length) > allowed) continue;
      const d = distance(token, word);
      if (d < bestDistance) {
        best = word;
        bestDistance = d;
      }
    }
    return best ? { token: best, corrected: true } : { token, corrected: false };
  }

  return function search(query: string, limit = 8): SearchEntry[] {
    const words = tokenize(query);
    const tokens: QueryToken[] = words
      .filter((word) => !STOP_WORDS.has(word))
      .map((word) => {
        const { token, corrected } = correct(word);
        return { raw: token, canonical: canon(token), corrected, required: !SOFT_WORDS.has(token) };
      });
    if (tokens.length === 0) return [];
    if (!tokens.some((t) => t.required)) tokens.forEach((t) => (t.required = true));
    const required = tokens.filter((t) => t.required);
    const queryPhrase = words.map((word) => canon(correct(word).token)).join(" ");

    const scored = indexed.map((item) => {
      let score = 0;
      let matched = 0;
      let nameMatched = 0;
      for (const token of tokens) {
        let best = 0;
        for (const f of item.fields) best = Math.max(best, matchScore(token, f) * f.weight);
        if (token.corrected) best *= CORRECTED_PENALTY;
        score += best;
        if (best > 0 && token.required) matched++;
        if (item.nameTokens.some((t) => t === token.canonical || t.startsWith(token.canonical))) nameMatched++;
      }
      if (words.length > 1) {
        if (item.namePhrase.includes(queryPhrase)) score += NAME_PHRASE_BONUS;
        else if (item.aliasPhrases.some((p) => p.includes(queryPhrase))) score += ALIAS_PHRASE_BONUS;
      }
      score += (Math.min(nameMatched, item.nameTokens.length) / item.nameTokens.length) * NAME_COVERAGE_BONUS;
      return { item, score, coverage: matched / required.length };
    });

    const complete = scored.filter((s) => s.coverage === 1);
    const pool = complete.length ? complete : scored.filter((s) => s.coverage >= 0.5);
    return pool
      .sort((a, b) => b.coverage - a.coverage || b.score - a.score || a.item.order - b.item.order)
      .slice(0, limit)
      .map((s) => s.item.entry);
  };
}
