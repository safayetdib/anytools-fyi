// Turning Bangla typed with Bijoy (SutonnyMJ and the other "MJ" fonts) into Unicode Bangla.
//
// Bijoy fonts draw Bangla letters in place of Latin ones: "Avwg" in SutonnyMJ shows as "আমি". Copy it out of a PDF
// and you get "Avwg" back. Bijoy also stores letters in the order they're drawn, so "ি" comes before the letter it
// follows when read, and "র্" after it. Converting maps each glyph, then puts the vowel signs and "র্" where Unicode
// expects them.

// Stands in for "র্" drawn after its letters, until it's moved back in front of them.
const REPH = "\uE000";

// Each Bijoy character, as Windows shows it, and the Unicode it draws.
const GLYPHS: Record<string, string> = {
  // Vowels and consonants.
  A: "অ", B: "ই", C: "ঈ", D: "উ", E: "ঊ", F: "ঋ", G: "এ", H: "ঐ", I: "ও", J: "ঔ",
  K: "ক", L: "খ", M: "গ", N: "ঘ", O: "ঙ", P: "চ", Q: "ছ", R: "জ", S: "ঝ", T: "ঞ",
  U: "ট", V: "ঠ", W: "ড", X: "ঢ", Y: "ণ", Z: "ত", _: "থ", "`": "দ", a: "ধ", b: "ন",
  c: "প", d: "ফ", e: "ব", f: "ভ", g: "ম", h: "য", i: "র", j: "ল", k: "শ", l: "ষ",
  m: "স", n: "হ", o: "\u09DC", p: "\u09DD", q: "\u09DF", r: "ৎ", s: "ং", t: "ঃ", u: "ঁ",
  // Digits and signs.
  "0": "০", "1": "১", "2": "২", "3": "৩", "4": "৪", "5": "৫", "6": "৬", "7": "৭", "8": "৮", "9": "৯",
  "|": "\u0964", "\\": "\u0965", "&": "্\u200C", $: "৳",
  "\u00D0": "\u2013", "\u00D1": "\u2014", "\u00D2": "\u201C", "\u00D3": "\u201D", "\u00D4": "\u2018", "\u00D5": "\u2019",
  // Vowel signs. Bijoy has several shapes of some, to sit well next to different letters.
  v: "া", w: "ি", x: "ী", y: "ু", z: "ু", "\u201C": "ু", "\u2013": "ু", "~": "ূ", "\u0192": "ূ", "\u201A": "ূ",
  "\u201E": "ৃ", "\u2026": "ৃ", "\u2020": "ে", "\u2021": "ে", "\u02C6": "ৈ", "\u2030": "ৈ", "\u0160": "ৗ",
  // Half letters and the small forms joined below or beside a letter.
  "^": "্ব", "\u2018": "্তু", "\u2019": "্থ", "\u2039": "্ক", "\u0152": "্ক্র", "\u201D": "চ্", "\u2014": "্ত",
  "\u02DC": "দ্", "\u2122": "দ্", "\u0161": "ন্", "\u203A": "ন্", "\u0153": "্ন", "\u0178": "্ব", "\u00A1": "্ব",
  "\u00A2": "্ভ", "\u00A3": "্ভ্র", "\u00A4": "ম্", "\u00A5": "্ম", "\u00A6": "্ব", "\u00A7": "্ম", "\u00A8": "্য",
  "\u00A9": REPH, "\u00AA": "্র", "\u00AB": "্র", "\u00AC": "্ল", "\u00AD": "্ল", "\u2212": "্ল", "\u00AE": "ষ্",
  "\u00AF": "স্", "\u00D6": "্র", "\u00E8": "্ন", "\u00FA": "্প", "\u2022": "ঙ্",
  // Joined letters drawn as one glyph.
  "\u00B0": "ক্ক", "\u00B1": "ক্ট", "\u00B2": "ক্ষ্ম", "\u00B3": "ক্ত", "\u00B4": "ক্ম", "\u00B5": "ক্র", "\u00B6": "ক্ষ",
  "\u00B7": "ক্স", "\u00B8": "গু", "\u00B9": "জ্ঞ", "\u00BA": "গ্দ", "\u00BB": "গ্ধ", "\u00BC": "ঙ্ক", "\u00BD": "ঙ্গ",
  "\u00BE": "জ্জ", "\u00BF": "্ত্র", "\u00C0": "জ্ঝ", "\u00C1": "জ্ঞ", "\u00C2": "ঞ্চ", "\u00C3": "ঞ্ছ", "\u00C4": "ঞ্জ",
  "\u00C5": "ঞ্ঝ", "\u00C6": "ট্ট", "\u00C7": "ড্ড", "\u00C8": "ণ্ট", "\u00C9": "ণ্ঠ", "\u00CA": "ণ্ড", "\u00CB": "ত্ত",
  "\u00CC": "ত্থ", "\u00CD": "ত্ম", "\u00CE": "ত্র", "\u00CF": "দ্দ", "\u00D7": "দ্ধ", "\u00D8": "দ্ব", "\u00D9": "দ্ম",
  "\u00DA": "ন্ঠ", "\u00DB": "ন্ড", "\u00DC": "ন্ধ", "\u00DD": "ন্স", "\u00DE": "প্ট", "\u00DF": "প্ত", "\u00E0": "প্প",
  "\u00E1": "প্স", "\u00E2": "ব্জ", "\u00E3": "ব্দ", "\u00E4": "ব্ধ", "\u00E5": "ভ্র", "\u00E6": "ম্ন", "\u00E7": "ম্ফ",
  "\u00E9": "ল্ক", "\u00EA": "ল্গ", "\u00EB": "ল্ট", "\u00EC": "ল্ড", "\u00ED": "ল্প", "\u00EE": "ল্ফ", "\u00EF": "শু",
  "\u00F0": "শ্চ", "\u00F1": "শ্ছ", "\u00F2": "ষ্ণ", "\u00F3": "ষ্ট", "\u00F4": "ষ্ঠ", "\u00F5": "ষ্ফ", "\u00F6": "স্খ",
  "\u00F7": "স্ট", "\u00F8": "স্ন", "\u00F9": "স্ফ", "\u00FB": "হু", "\u00FC": "হৃ", "\u00FD": "হ্ন", "\u00FE": "হ্ম",
  // Newer Bijoy fonts draw "ক্ষ" here; older ones drew the rare "ড়্গ".
  "\u00FF": "ক্ষ",
};

const HASANTA = "্";
const PRE_KARS = new Set(["ি", "ে", "ৈ"]);
const POST_KARS = new Set(["া", "ী", "ু", "ূ", "ৃ", "ৗ", "ো", "ৌ"]);
const isConsonant = (c: string | undefined) => !!c && ((c >= "ক" && c <= "হ") || c === "\u09DC" || c === "\u09DD" || c === "\u09DF" || c === "ৎ");

// The letters that make up one joined letter starting at `start`: a consonant, then any more joined on with "্".
function clusterEnd(chars: string[], start: number): number {
  if (!isConsonant(chars[start])) return start;
  let end = start + 1;
  while (chars[end] === HASANTA && isConsonant(chars[end + 1])) end += 2;
  return end;
}

/** Converts text typed with a Bijoy font into Unicode Bangla. */
export function bijoyToUnicode(text: string): string {
  let mapped = "";
  let last = "";
  // "র্" typed twice by mistake shows once.
  for (const c of text.replace(/\u00A9+/g, "\u00A9")) {
    // The small "ন" below a letter is "ণ" under "ষ", "ণ" and "হ", as in "তীক্ষ্ণ", "বিষণ্ণ" and "অপরাহ্ণ".
    if ((c === "\u00E8" || c === "\u0153") && /[ষণহ]$/.test(last)) mapped += "্ণ";
    // After "র", newer Bijoy fonts use the glyph for "ম্ন" as the "ু" hanging below it, as in "বিরুদ্ধে".
    else if (c === "\u00E6" && last.endsWith("র")) mapped += "ু";
    else mapped += GLYPHS[c] ?? c;
    last = mapped;
  }
  // Glyphs that each bring their own "্" can leave two in a row.
  mapped = mapped.replace(/্্/g, HASANTA);
  // A vowel sign typed before "্য" or another joined letter goes after it, as in "বিদ্যুৎ".
  mapped = mapped.replace(/([াীুূৃ])(্[ক-হ])/g, "$2$1");
  // "র" with "্য" under it is the joined "র\u200D্য" of "র্যাব", not "র্" over "য".
  mapped = mapped.replace(/(?<!্)র্য/g, "র\u200D্য");
  const chars = [...mapped];

  // "র্" goes back in front of the joined letter, and any vowel sign, it was drawn after.
  for (let i = 0; i < chars.length; i++) {
    if (chars[i] !== REPH) continue;
    let start = i;
    if (POST_KARS.has(chars[start - 1])) start--;
    if (isConsonant(chars[start - 1])) {
      start--;
      while (chars[start - 1] === HASANTA && isConsonant(chars[start - 2])) start -= 2;
    }
    chars.splice(i, 1);
    chars.splice(start, 0, "র", HASANTA);
    i++;
  }

  const out: string[] = [];
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (PRE_KARS.has(c)) {
      // "ঁ" typed before the letter goes after it.
      const moon = chars[i + 1] === "ঁ";
      const start = i + 1 + (moon ? 1 : 0);
      const end = clusterEnd(chars, start);
      if (end > start) {
        out.push(...chars.slice(start, end));
        if (c === "ে" && chars[end] === "া") out.push("ো");
        else if (c === "ে" && chars[end] === "ৗ") out.push("ৌ");
        else out.push(c);
        const skip = c === "ে" && (chars[end] === "া" || chars[end] === "ৗ") ? 1 : 0;
        if (moon) out.push("ঁ");
        i = end - 1 + skip;
        continue;
      }
    }
    // "ঁ" goes after the vowel sign that follows it.
    if (c === "ঁ" && POST_KARS.has(chars[i + 1])) {
      out.push(chars[i + 1], c);
      i++;
      continue;
    }
    out.push(c);
  }

  return (
    out
      .join("")
      .replace(/অা/g, "আ")
      // A "্" shown on its own only needs keeping apart from a letter that follows it.
      .replace(/্\u200C(?![ক-হ\u09DC\u09DD\u09DF])/g, HASANTA)
      // A vowel sign typed twice by mistake shows once.
      .replace(/([াীুূৃ])\1+/g, "$1")
      // The standard form, which spells "য়" as "য" with a dot, like most Bangla typed today.
      .normalize("NFC")
  );
}

/** True for a Bijoy font: SutonnyMJ, TonnyMJ and the rest of the "MJ" fonts, and the "ANSI" Bangla fonts. */
export function isBijoyFont(name: string | undefined): boolean {
  if (!name) return false;
  // Embedded fonts often start with a six-letter tag, like "ABCDEF+SutonnyMJ".
  const base = name.replace(/^[A-Z]{6}\+/, "");
  return /MJ(?:$|[-,_ ]|Bold|Italic)/.test(base) || /\bANSI\b/i.test(base);
}
