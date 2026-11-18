export const MODULE_ID = "character-creation-beautifier";
export const TEMPLATE_ROOT = `modules/${MODULE_ID}/templates`;

/** Turn any collection-like value (Foundry Collection, RecordCollection, Map, array, object) into an array of values. */
export function toArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (Array.isArray(value.contents)) return value.contents;
  if (typeof value[Symbol.iterator] === "function") return Array.from(value);
  if (typeof value === "object") return Object.values(value);
  return [];
}

/** Strip HTML to plain text and clip it. */
export function plainText(html, max = 180) {
  if (!html) return "";
  const div = document.createElement("div");
  div.innerHTML = html;
  const text = (div.textContent ?? "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

export function slugify(text) {
  return String(text ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Coerce anything to a finite number. Non-numeric input (undefined, null,
 * "", "@level", NaN, {value: 2}) becomes the fallback, and is reported once
 * in the console with a label so bad data can be traced.
 */
const _reported = new Set();
export function num(value, fallback = 0, label = null) {
  if (value && typeof value === "object" && "value" in value) value = value.value;
  const n = typeof value === "string" && value.trim() === "" ? NaN : Number(value);
  if (Number.isFinite(n)) return n;
  if (label && value !== undefined && value !== null && !_reported.has(label)) {
    _reported.add(label);
    console.warn(`${MODULE_ID} | Non-numeric value for ${label}:`, value, `→ using ${fallback}`);
  }
  return fallback;
}
