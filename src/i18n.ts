// Screen text for the page. The main process (tray, native menu, dialogs) reads the same files in `locales/`.
import ko from "../locales/ko.json";

type Key = keyof typeof ko;
type Table = Record<string, string>;

// Every `locales/<code>.json` is bundled; the file name is the locale code (e.g. `zh-Hans`).
const files = import.meta.glob<Table>("../locales/*.json", { eager: true, import: "default" });
const tables: Record<string, Table> = Object.fromEntries(
  Object.entries(files).map(([path, table]) => [path.replace(/^.*\/(.+)\.json$/, "$1"), table]),
);

/** Picks the best bundled locale for a tag like `de-AT` or `zh-Hant-TW`: exact code, then language, else `en`. */
function pickLocale(tag: string): string {
  const exact = Object.keys(tables).find((code) => code.toLowerCase() === tag.toLowerCase());
  if (exact) return exact;
  const language = tag.split(/[-_]/)[0].toLowerCase();
  // Why: Taiwan, Hong Kong and Macau write traditional characters; every other Chinese tag reads simplified.
  if (language === "zh") return /-(hant|tw|hk|mo)\b/i.test(tag.replace(/_/g, "-")) ? "zh-Hant" : "zh-Hans";
  return language in tables ? language : "en";
}

export const locale = pickLocale(navigator.language || "en");
const table: Table = tables[locale];

document.documentElement.lang = locale;
document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";

const plurals = new Intl.PluralRules(locale);

/**
 * Looks up `key` and fills `{{name}}` slots; a key this language lacks reads in English, never as the bare key.
 * A numeric `count` first tries the plural form `<key>.<category>` (`grid.subtitle.few`); the plain key is the `other` form.
 */
export function t(key: Key, args: Record<string, string | number> = {}): string {
  const form = typeof args.count === "number" ? `${key}.${plurals.select(args.count)}` : key;
  let text = table[form] ?? table[key] ?? tables.en?.[form] ?? tables.en?.[key] ?? key;
  for (const [name, value] of Object.entries(args)) {
    text = text.replaceAll(`{{${name}}}`, String(value));
  }
  return text;
}

/** "RUNNERS Mac Studio · Remote Off · Screen Recording Needed": the computer, the state and, while off, why. */
export function statusText(state: "off" | "waiting" | "viewing", reason: "platform" | "screenRecording" | "signedOut" | null): string {
  const parts = [t(`status.${state}`)];
  if (reason) parts.push(t(`status.reason.${reason}`));
  return parts.join(" · ");
}
