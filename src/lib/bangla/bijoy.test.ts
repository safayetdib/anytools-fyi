import { describe, expect, it } from "vitest";
import { bijoyToUnicode, isBijoyFont } from "./bijoy";

// Unicode has two spellings of "য়", "ড়" and "ঢ়"; compared in one.
const same = (text: string) => text.normalize("NFD");

describe("bijoyToUnicode", () => {
  it.each([
    ["Avgvi", "আমার"],
    ["evsjv", "বাংলা"],
    ["Avwg evsjvq †`wL ¯^cœ!", "আমি বাংলায় দেখি স্বপ্ন!"],
    ["MYcÖRvZš¿x evsjv‡`k miKvi", "গণপ্রজাতন্ত্রী বাংলাদেশ সরকার"],
    ["Pvu`", "চাঁদ"],
    ["`ytL", "দুঃখ"],
    ["wKsKZ©e¨weg~p", "কিংকর্তব্যবিমূঢ়"],
    ["Kg©x", "কর্মী"],
    ["a‡g©i", "ধর্মের"],
    ["†cÖg", "প্রেম"],
    ["†Kv‡bv", "কোনো"],
    ["†gŠgvwQ", "মৌমাছি"],
    ["wKš‘", "কিন্তু"],
    ["we`¨yr", "বিদ্যুৎ"],
    ["i¨ve", "র\u200D্যাব"],
    ["ˆewPÎ¨", "বৈচিত্র্য"],
    ["Zx¶è", "তীক্ষ্ণ"],
    ["Acivnœ", "অপরাহ্ণ"],
    ["j²x", "লক্ষ্মী"],
    ["12/03/2024 Zvwi‡L", "১২/০৩/২০২৪ তারিখে"],
    ["‡kl| ÒfvlvÓ 500$", "শেষ। “ভাষা” ৫০০৳"],
    // As SutonnyMJ PDFs made today hold them.
    ["cixÿvq", "পরীক্ষায়"],
    ["†ÿ‡Î", "ক্ষেত্রে"],
    ["weiæ‡×", "বিরুদ্ধে"],
    ["wbæ", "নিম্ন"],
    ["we`y¨r", "বিদ্যুৎ"],
    ["cwieZ©©b", "পরিবর্তন"],
    ["wb‡¤œv³ KvMRcÎvw`", "নিম্নোক্ত কাগজপত্রাদি"],
    ["jvB‡m‡Ýi aiY", "লাইসেন্সের ধরণ"],
  ])("%s becomes %s", (bijoy, unicode) => {
    expect(same(bijoyToUnicode(bijoy))).toBe(same(unicode));
  });

  it("keeps a hasanta that stands on its own, and the joiner only where a letter follows", () => {
    expect(bijoyToUnicode("K&")).toBe("ক্");
    expect(bijoyToUnicode("O&³")).toBe("ঙ্\u200Cক্ত");
  });

  it("fixes vowel signs typed twice and the moon sign typed before a vowel sign", () => {
    expect(bijoyToUnicode("Kyy")).toBe("কু");
    expect(bijoyToUnicode("‡uK")).toBe("কেঁ");
  });
});

describe("isBijoyFont", () => {
  it.each(["SutonnyMJ", "SutonnyMJ-Bold", "ABCDEF+SutonnyOMJ", "TonnyMJ,Italic", "SutonnyMJBold", "SiyamRupali ANSI"])("%s is a Bijoy font", (name) => {
    expect(isBijoyFont(name)).toBe(true);
  });

  it.each(["Kalpurush", "Nikosh", "NirmalaUI", "TimesNewRomanPSMT", "MJJournal", undefined])("%s is not", (name) => {
    expect(isBijoyFont(name)).toBe(false);
  });
});
