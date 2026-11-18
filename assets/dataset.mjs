const ACCESS_TYPES = new Set(["always-free", "free-models", "trial-credits", "local"]);
const CONFIDENCE_LEVELS = new Set(["high", "medium", "low"]);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isISODate(value) {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isURL(value, protocols) {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    return protocols.includes(new URL(value.replace(/\{[^}]+\}/g, "placeholder")).protocol);
  } catch {
    return false;
  }
}

/** Problems that make the whole file unusable (no providers, broken metadata). */
function structuralErrors(payload) {
  const errors = [];
  const meta = payload?.meta;
  const providers = payload?.providers;

  if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
    errors.push("Dataset metadata is missing or invalid.");
  } else {
    if (!isISODate(meta.updated)) errors.push("Dataset metadata has an invalid updated date.");
    if (typeof meta.version !== "string" || !meta.version.trim()) errors.push("Dataset metadata is missing a version.");
  }

  if (!Array.isArray(providers) || providers.length === 0) {
    errors.push("Provider list is missing or empty.");
  }
  return errors;
}

/** Schema problems for one provider entry. An empty array means the entry is usable. */
export function validateProvider(provider, label = "Provider") {
  const errors = [];
  if (!provider || typeof provider !== "object" || Array.isArray(provider)) {
    return [`${label} is not an object.`];
  }

  for (const field of ["id", "name", "vendor", "kind", "summary", "regions", "notes"]) {
    if (typeof provider[field] !== "string" || !provider[field].trim()) {
      errors.push(`${label} is missing ${field}.`);
    }
  }
  if (typeof provider.id === "string" && provider.id.trim() && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(provider.id)) {
    errors.push(`${label} has an invalid id.`);
  }
  if (!ACCESS_TYPES.has(provider.access)) errors.push(`${label} has an invalid access type.`);
  if (!CONFIDENCE_LEVELS.has(provider.confidence)) errors.push(`${label} has an invalid confidence level.`);
  if (typeof provider.openaiCompatible !== "boolean") errors.push(`${label} has an invalid OpenAI compatibility flag.`);
  if (typeof provider.creditCard !== "boolean") errors.push(`${label} has an invalid credit card flag.`);
  if (!Array.isArray(provider.models) || provider.models.some((value) => typeof value !== "string")) {
    errors.push(`${label} has an invalid models list.`);
  }
  if (!Array.isArray(provider.tags) || provider.tags.some((value) => typeof value !== "string")) {
    errors.push(`${label} has an invalid tags list.`);
  }
  if (!provider.limits || typeof provider.limits !== "object" || Array.isArray(provider.limits)) {
    errors.push(`${label} has invalid limits.`);
  } else {
    for (const field of ["rpm", "rpd", "tpm", "tpd"]) {
      const value = provider.limits[field];
      if (value != null && (typeof value !== "number" || !Number.isFinite(value) || value < 0)) {
        errors.push(`${label} has an invalid ${field} limit.`);
      }
    }
    if (provider.limits.text != null && typeof provider.limits.text !== "string") {
      errors.push(`${label} has invalid limit notes.`);
    }
  }
  if (!isURL(provider.apiBase, ["http:", "https:"])) errors.push(`${label} has an invalid API base URL.`);
  for (const field of ["signup", "docs", "pricing"]) {
    if (!isURL(provider[field], ["https:"])) errors.push(`${label} has an invalid ${field} URL.`);
  }
  if (!isISODate(provider.verified)) errors.push(`${label} has an invalid verified date.`);
  return errors;
}

/**
 * Splits a dataset into usable providers and warnings, so that one malformed
 * entry hides that entry instead of taking the whole site down.
 * `fatal` is non-empty only when nothing can be shown at all.
 */
export function loadDataset(payload) {
  const fatal = structuralErrors(payload);
  if (!Array.isArray(payload?.providers) || payload.providers.length === 0) {
    return { meta: {}, providers: [], warnings: [], fatal };
  }

  const warnings = [];
  const providers = [];
  const ids = new Set();
  const meta = payload.meta && typeof payload.meta === "object" ? payload.meta : {};

  if (!Number.isInteger(meta.count)) {
    warnings.push("Dataset metadata has an invalid provider count.");
  } else if (meta.count !== payload.providers.length) {
    warnings.push(`Dataset count says ${meta.count}, but contains ${payload.providers.length} providers.`);
  }

  payload.providers.forEach((provider, index) => {
    const label = `Provider ${index + 1}${typeof provider?.id === "string" ? ` (${provider.id})` : ""}`;
    const errors = validateProvider(provider, label);
    if (typeof provider?.id === "string") {
      if (ids.has(provider.id)) errors.push(`Duplicate provider id: ${provider.id}.`);
      ids.add(provider.id);
    }
    if (errors.length) { warnings.push(...errors); return; }
    providers.push(provider);
  });

  if (!providers.length) fatal.push("No provider entry passed validation.");
  return { meta, providers, warnings, fatal };
}

/** Every problem in the file; the test suite requires this to be empty for the checked-in data. */
export function validateDataset(payload) {
  const { warnings, fatal } = loadDataset(payload);
  return [...new Set([...fatal, ...warnings])];
}

export function keyTestSupport(provider, pageProtocol) {
  if (!provider.openaiCompatible) {
    return { reason: "This provider uses a native API. The generic OpenAI-compatible /models check is not applicable; use the provider's quickstart or docs instead." };
  }
  if (/\{[^}]+\}/.test(provider.apiBase)) {
    return { reason: "This API URL contains a required placeholder. Configure the provider-specific endpoint before testing; your key was not sent." };
  }

  let base;
  try { base = new URL(provider.apiBase); } catch { return { reason: "The API base URL is invalid; your key was not sent." }; }
  if (base.protocol !== "https:" && base.protocol !== "http:") {
    return { reason: "This API protocol cannot be tested safely in a browser; your key was not sent." };
  }
  if (base.username || base.password) {
    return { reason: "The API URL contains embedded credentials; your key was not sent." };
  }
  if (base.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(base.hostname)) {
    return { reason: "Unencrypted remote API URLs are not tested in a browser; your key was not sent." };
  }
  if (pageProtocol === "https:" && base.protocol === "http:") {
    return { reason: "This API uses HTTP and cannot be called from this HTTPS page. Your key was not sent; run the site locally over HTTP or use the provider's CLI." };
  }

  base.pathname = `${base.pathname.replace(/\/$/, "")}/models`;
  base.search = "";
  base.hash = "";
  return { endpoint: base.href };
}
export function daysSince(dateString, now = new Date()) {
  if (!isISODate(dateString)) return null;
  const date = new Date(`${dateString}T00:00:00Z`);
  return Math.floor((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - date.getTime()) / 86400000);
}