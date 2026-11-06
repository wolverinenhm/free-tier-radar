import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { daysSince, keyTestSupport, validateDataset } from "../assets/dataset.mjs";

const source = JSON.parse(await readFile(new URL("../data/providers.json", import.meta.url), "utf8"));

test("checked-in provider data meets the expected schema", () => {
  assert.deepEqual(validateDataset(source), []);
});

test("dataset validation reports count, duplicate IDs, and invalid dates", () => {
  const invalid = structuredClone(source);
  invalid.meta.count += 1;
  invalid.providers[1].id = invalid.providers[0].id;
  invalid.providers[0].verified = "2026-02-30";
  invalid.providers[2].name = " ";
  invalid.providers[3].apiBase = "javascript:alert(1)";

  const errors = validateDataset(invalid).join(" ");
  assert.match(errors, /count says/);
  assert.match(errors, /Duplicate provider id/);
  assert.match(errors, /invalid verified date/);
  assert.match(errors, /missing name/);
  assert.match(errors, /invalid API base URL/);
});

test("key checks only target supported and safe provider endpoints", () => {
  const groq = source.providers.find((provider) => provider.id === "groq");
  const cohere = source.providers.find((provider) => provider.id === "cohere");
  const cloudflare = source.providers.find((provider) => provider.id === "cloudflare-workers-ai");
  const ollama = source.providers.find((provider) => provider.id === "ollama");

  assert.equal(keyTestSupport(groq, "https:").endpoint, `${groq.apiBase}/models`);
  assert.match(keyTestSupport(cohere, "https:").reason, /native API/);
  assert.match(keyTestSupport(cloudflare, "https:").reason, /placeholder/);
  assert.match(keyTestSupport(ollama, "https:").reason, /HTTP/);
  assert.equal(keyTestSupport(ollama, "http:").endpoint, `${ollama.apiBase}/models`);
  assert.match(keyTestSupport({ ...groq, apiBase: "http://api.example.test/v1" }, "http:").reason, /Unencrypted remote/);
});
test("freshness age uses calendar days and rejects invalid dates", () => {
  const now = new Date("2026-11-07T04:00:00Z");
  assert.equal(daysSince("2026-11-06", now), 1);
  assert.equal(daysSince("2026-11-09", now), -2);
  assert.equal(daysSince("not-a-date", now), null);
});
