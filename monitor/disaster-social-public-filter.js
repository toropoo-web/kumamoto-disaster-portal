"use strict";

function isInstagramCommunitySource(source) {
  if (!source) {
    return false;
  }
  const sourceType = String(source.source_type || "").trim();
  const platform = String(source.platform || "").trim();
  return sourceType === "Instagram" || platform === "Instagram";
}

function isInstagramCommunityEntry(entry, sourceLookup) {
  entry = entry || {};
  if (String(entry.source_type || "").trim() === "Instagram") {
    return true;
  }
  if (String(entry.import_format || "").trim() === "SNS" && String(entry.platform || "").trim() === "Instagram") {
    return true;
  }
  const sourceMeta = (sourceLookup && sourceLookup[entry.source]) || {};
  return isInstagramCommunitySource(sourceMeta);
}

function filterPublicCommunitySources(sourcesPayload) {
  const payload = Object.assign({}, sourcesPayload || {});
  const sources = (payload.sources || []).filter(function (source) {
    return !isInstagramCommunitySource(source);
  });
  const snsFetch = Object.assign({}, payload.sns_fetch || {});
  if (Array.isArray(snsFetch.platforms)) {
    snsFetch.platforms = snsFetch.platforms.filter(function (platform) {
      return platform !== "Instagram";
    });
  }
  return Object.assign({}, payload, { sources: sources, sns_fetch: snsFetch });
}

function filterPublicCommunityEntries(entries, sourcesPayload) {
  const sourceLookup = {};
  ((sourcesPayload && sourcesPayload.sources) || []).forEach(function (source) {
    if (source && source.source_id) {
      sourceLookup[source.source_id] = source;
    }
  });
  return (entries || []).filter(function (entry) {
    return !isInstagramCommunityEntry(entry, sourceLookup);
  });
}

module.exports = {
  isInstagramCommunitySource,
  isInstagramCommunityEntry,
  filterPublicCommunitySources,
  filterPublicCommunityEntries
};
