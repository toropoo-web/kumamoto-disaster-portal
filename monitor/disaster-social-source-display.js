"use strict";

const SOCIAL_SOURCE_TYPE_LABELS = {
  X: "X",
  Instagram: "Instagram",
  WEB: "WEB",
  MANUAL: "MANUAL",
  OTHER: "その他"
};

function resolveSocialSourceTypeLabel(item, sourceMeta) {
  item = item || {};
  sourceMeta = sourceMeta || {};
  const raw = String(item.source_type || sourceMeta.source_type || "").trim();
  if (raw && SOCIAL_SOURCE_TYPE_LABELS[raw]) {
    return SOCIAL_SOURCE_TYPE_LABELS[raw];
  }
  if (raw) {
    return raw;
  }
  const platform = String(sourceMeta.platform || "").trim();
  if (platform && SOCIAL_SOURCE_TYPE_LABELS[platform]) {
    return SOCIAL_SOURCE_TYPE_LABELS[platform];
  }
  if (platform) {
    return platform;
  }
  return "不明";
}

function resolveSocialSourceName(item, sourceMeta) {
  item = item || {};
  sourceMeta = sourceMeta || {};
  return sourceMeta.name || item.source || "情報元不明";
}

function resolveSocialSourceDefinitionUrl(sourceMeta) {
  sourceMeta = sourceMeta || {};
  const { resolveExternalUrl } = require("./disaster-social-url");
  return resolveExternalUrl(sourceMeta.source_url || sourceMeta.url || "");
}

function buildSocialSourceLookupFromPayload(sourcesPayload) {
  const lookup = {};
  ((sourcesPayload && sourcesPayload.sources) || []).forEach(function (source) {
    if (source && source.source_id) {
      lookup[source.source_id] = source;
    }
  });
  return lookup;
}

function enrichSocialIndexEntry(entry, sourceLookup) {
  const next = Object.assign({}, entry);
  const sourceMeta = sourceLookup[entry.source] || {};

  if (!next.source_type && sourceMeta.source_type) {
    next.source_type = sourceMeta.source_type;
  }
  if (typeof next.captured_at !== "string") {
    next.captured_at = "";
  }
  if (typeof next.url !== "string") {
    next.url = "";
  }
  if (typeof next.source !== "string") {
    next.source = entry.source || "";
  }

  return next;
}

function enrichSocialIndexPayload(indexPayload, sourcesPayload) {
  const sourceLookup = buildSocialSourceLookupFromPayload(sourcesPayload);
  const entries = (indexPayload && indexPayload.entries) || [];
  return Object.assign({}, indexPayload, {
    entries: entries.map(function (entry) {
      return enrichSocialIndexEntry(entry, sourceLookup);
    })
  });
}

function normalizeSocialSourcesPayload(sourcesPayload) {
  const sources = ((sourcesPayload && sourcesPayload.sources) || []).map(function (source) {
    const next = Object.assign({}, source);
    if (typeof next.source_url !== "string") {
      next.source_url = typeof next.url === "string" ? next.url : "";
    }
    return next;
  });
  return Object.assign({}, sourcesPayload, { sources: sources });
}

module.exports = {
  SOCIAL_SOURCE_TYPE_LABELS,
  resolveSocialSourceTypeLabel,
  resolveSocialSourceName,
  resolveSocialSourceDefinitionUrl,
  buildSocialSourceLookupFromPayload,
  enrichSocialIndexEntry,
  enrichSocialIndexPayload,
  normalizeSocialSourcesPayload
};
