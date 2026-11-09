// Spoken Urdu, recognised by the browser as Hindi (the same spoken language,
// written in Devanagari), turned into Roman Urdu: "मैं कल आऊँगा" → "main kal aaunga".
// Devanagari spells every vowel, so it romanises more faithfully than Urdu script.

const CONSONANTS: Record<string, string> = {
  क: "k", ख: "kh", ग: "g", घ: "gh", ङ: "n",
  च: "ch", छ: "chh", ज: "j", झ: "jh", ञ: "n",
  ट: "t", ठ: "th", ड: "d", ढ: "dh", ण: "n",
  त: "t", थ: "th", द: "d", ध: "dh", न: "n",
  प: "p", फ: "ph", ब: "b", भ: "bh", म: "m",
  य: "y", र: "r", ल: "l", व: "w", श: "sh", ष: "sh", स: "s", ह: "h",
  // precomposed nukta letters
  क़: "q", ख़: "kh", ग़: "gh", ज़: "z", ड़: "r", ढ़: "rh", फ़: "f", य़: "y",
};
// A consonant followed by the nukta sign (U+093C).
const NUKTA: Record<string, string> = { क: "q", ख: "kh", ग: "gh", ज: "z", ड: "r", ढ: "rh", फ: "f", य: "y" };

const VOWELS: Record<string, string> = {
  अ: "a", आ: "aa", इ: "i", ई: "ee", उ: "u", ऊ: "oo", ऋ: "ri", ए: "e", ऐ: "ai", ओ: "o", औ: "au", ऑ: "o",
};
const MATRAS: Record<string, string> = {
  "ा": "aa", "ि": "i", "ी": "ee", "ु": "u", "ू": "oo", "ृ": "ri", "े": "e", "ै": "ai", "ो": "o", "ौ": "au", "ॉ": "o",
};
const VIRAMA = "्";
const NUKTA_SIGN = "़";
const NASAL = new Set(["ं", "ँ"]);
const DIGITS = "०१२३४५६७८९";

type Syllable = { c: string; v: string | null; inherent: boolean }; // inherent: unwritten "a"

function romaniseWord(word: string): string {
  const parts: (Syllable | string)[] = [];
  const chars = [...word];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (CONSONANTS[ch] !== undefined) {
      let c = CONSONANTS[ch];
      if (chars[i + 1] === NUKTA_SIGN) {
        c = NUKTA[ch] ?? c;
        i++;
      }
      const next = chars[i + 1];
      if (next === VIRAMA) {
        parts.push({ c, v: "", inherent: false });
        i++;
      } else if (next && MATRAS[next] !== undefined) {
        parts.push({ c, v: MATRAS[next], inherent: false });
        i++;
      } else {
        parts.push({ c, v: "a", inherent: true });
      }
    } else if (VOWELS[ch] !== undefined) {
      parts.push({ c: "", v: VOWELS[ch], inherent: false });
    } else if (NASAL.has(ch)) {
      parts.push("n");
    } else if (ch === "ः") {
      parts.push("h");
    } else if (DIGITS.includes(ch)) {
      parts.push(String(DIGITS.indexOf(ch)));
    } else if (ch === "।") {
      parts.push(".");
    } else {
      parts.push(ch);
    }
  }

  // Drop the unwritten "a" where Urdu doesn't say it: at the end of a word,
  // and between a vowel and a consonant that carries its own vowel (kar-ta).
  const syl = parts.map((p, i) => ({ p, i })).filter((x): x is { p: Syllable; i: number } => typeof x.p !== "string");
  if (syl.length > 1) {
    const last = syl[syl.length - 1].p;
    if (last.inherent) last.v = "";
    for (let k = syl.length - 2; k >= 1; k--) {
      const cur = syl[k].p;
      const prev = syl[k - 1].p;
      const next = syl[k + 1].p;
      if (cur.inherent && cur.c && prev.v && next.c && next.v) cur.v = "";
    }
  }

  let out = parts.map((p) => (typeof p === "string" ? p : p.c + (p.v ?? ""))).join("");
  out = out.replace(/aa$/, "a"); // kyaa → kya, thaa → tha
  return out;
}

/** Romanise any Devanagari in `text`; other characters pass through unchanged. */
export function toRomanUrdu(text: string): string {
  return text.replace(/[ऀ-ॿ]+/g, (w) => romaniseWord(w));
}
