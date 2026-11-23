import { describe, expect, it } from "vitest";
import { detectScript } from "../src/util";

describe("detectScript: the script comes from the text itself", () => {
  const cases: [string, string, string, string][] = [
    ["Tamil", "தாமிரபரணியில் வெள்ளப் பெருக்கு: 4,200 பேர் பாதுகாப்பு முகாம்களுக்கு மாற்றம்", "Taml", "ta"],
    ["Telugu", "హైదరాబాద్‌లో భారీ వర్షాలు కురిశాయి", "Telu", "te"],
    ["Kannada", "ಬೆಂಗಳೂರಿನಲ್ಲಿ ಇಂದು ಭಾರೀ ಮಳೆ", "Knda", "kn"],
    ["Malayalam", "കൊച്ചിയിൽ ഇന്ന് കനത്ത മഴ", "Mlym", "ml"],
    ["Bengali", "কলকাতায় আজ ভারী বৃষ্টি", "Beng", "bn"],
    ["Gujarati", "અમદાવાદમાં આજે ભારે વરસાદ", "Gujr", "gu"],
    ["Odia", "ଭୁବନେଶ୍ୱରରେ ଆଜି ବର୍ଷା", "Orya", "or"],
    ["Punjabi (Gurmukhi)", "ਜਲੰਧਰ ਵਿੱਚ ਅੱਜ ਮੀਂਹ", "Guru", "pa"],
    ["Hindi (Devanagari)", "दिल्ली में आज बारिश", "Deva", "hi"],
    ["Urdu (Arabic)", "لاہور میں آج بارش", "Arab", "ur"],
    ["English", "Heavy rain in the valley today", "Latn", "en"],
  ];
  for (const [name, text, script, lang] of cases) it(`${name}: ${script}/${lang}`, () => expect(detectScript(text)).toEqual({ script, lang }));
  it("a Tamil story with English acronyms and digits is still Tamil", () => {
    expect(detectScript("ஜிஎஸ்டி (GST) வருவாய் 2026 ஆம் ஆண்டில் 12% உயர்வு; IT நிறுவனங்கள் வரவேற்பு")).toEqual({ script: "Taml", lang: "ta" });
  });
  it("empty text falls back to Latin/English", () => { expect(detectScript("")).toEqual({ script: "Latn", lang: "en" }); });
});
