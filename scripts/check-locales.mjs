#!/usr/bin/env node
// Checks every file in locales/ against ko.json, which is the source of truth:
// each locale must have exactly ko's keys and the same {{placeholders}} in every value.
// Keys in `plurals` also need `<key>.<category>` for each category the language has in the counts that key can show.
// Run: node scripts/check-locales.mjs   (exits 1 when anything is off)

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "locales");
const load = (file) => JSON.parse(readFileSync(join(dir, file), "utf8"));
const slots = (text) => [...new Set(String(text).match(/\{\{\s*\w+\s*\}\}/g) ?? [])].sort().join(" ");

// The keys that change with a number, and the smallest number each can show.
const plurals = { "grid.subtitle": 0, "account.online": 0, "grid.monitors": 2 };
const categories = (locale, from) => {
  const rules = new Intl.PluralRules(locale);
  const found = new Set();
  for (let n = from; n <= 200; n++) found.add(rules.select(n));
  found.delete("other");
  return [...found];
};
const isSubset = (text, full) => slots(text).split(" ").filter(Boolean).every((slot) => full.includes(slot));

const source = load("ko.json");
const sourceKeys = Object.keys(source);
const files = readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "ko.json").sort();
let problems = 0;

for (const file of files) {
  const table = load(file);
  const locale = file.replace(/\.json$/, "");
  const issues = [];
  const forms = new Map();
  for (const [key, from] of Object.entries(plurals)) {
    for (const category of categories(locale, from)) forms.set(`${key}.${category}`, key);
  }
  for (const [form, key] of forms) {
    if (!(form in table)) issues.push(`missing plural form: ${form}`);
    // Why: Arabic says "one computer" and "two computers" with the noun alone, so a form may leave the number out.
    else if (!isSubset(table[form], slots(source[key]))) issues.push(`placeholders differ: ${form}`);
  }
  for (const key of sourceKeys) {
    if (!(key in table)) issues.push(`missing key: ${key}`);
    else if (typeof table[key] !== "string") issues.push(`not a string: ${key}`);
    else if (slots(table[key]) !== slots(source[key])) {
      issues.push(`placeholders differ: ${key} (ko: "${slots(source[key])}", ${file}: "${slots(table[key])}")`);
    }
  }
  for (const key of Object.keys(table)) {
    if (!(key in source) && !forms.has(key)) issues.push(`extra key: ${key}`);
  }
  if (issues.length) {
    problems += issues.length;
    console.log(`FAIL ${file}`);
    for (const issue of issues) console.log(`  - ${issue}`);
  } else {
    console.log(`ok   ${file}`);
  }
}

console.log(`\n${files.length + 1} locales, ${sourceKeys.length} keys each, ${problems} problem(s)`);
process.exit(problems ? 1 : 0);
