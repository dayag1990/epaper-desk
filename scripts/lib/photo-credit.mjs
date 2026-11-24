// Photo credit rules for the demo sites (shared by match-photos-ta.mjs and its tests).
// Owner decision: a photo licensed CC BY or CC BY-SA is credited in its caption line; CC0 and public domain need no credit.
// The credit travels as part of the caption string in the RSS feed (<media:description>), so a re-sync keeps it.

/** True for CC BY and CC BY-SA licences of any version (the ones that ask for attribution). NC / ND / unknown never get here. */
export const needsCredit = (licence) => /^CC[ -]BY(?:[ -](?:SA))?(?:[ -]\d(?:\.\d)?)?$/i.test(String(licence ?? "").trim());

/** The creator name as it should be printed: ORCID numbers that Commons sometimes puts after a name are dropped. */
export const cleanCreator = (s) =>
  String(s ?? "")
    .replace(/\b\d{4}[ -]\d{4}[ -]\d{4}[ -]\d{3}[\dX]\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const LABEL = { ta: "படம்", en: "Photo" };
/** `படம்: <creator>, CC BY-SA 4.0, Wikimedia Commons` (Tamil) / `Photo: <creator>, CC BY 4.0, Wikimedia Commons` (English). Empty when no credit is owed. */
export function creditLine(photo, lang = "ta") {
  if (!needsCredit(photo.licence_short)) return "";
  const who = cleanCreator(photo.creator);
  if (!who) return "";
  return `${LABEL[lang] ?? LABEL.en}: ${who}, ${photo.licence_short}, Wikimedia Commons`;
}

const FILE_PHOTO = { ta: "கோப்புப் படம்", en: "File photo" };
/** The caption printed under the photo: the file-photo note, then the credit (when owed) after a dot. */
export function captionFor(photo, lang = "ta") {
  const c = creditLine(photo, lang);
  return c ? `${FILE_PHOTO[lang] ?? FILE_PHOTO.en} · ${c}` : (FILE_PHOTO[lang] ?? FILE_PHOTO.en);
}
