"use strict";

const X_BLOCKED_PATTERNS = [
  /x_feed/i,
  /twitter/i,
  /x\.com/i,
  /MUNICIPAL_X/i
];

function isXRelatedSource(source) {
  if (!source) {
    return false;
  }

  const haystack = [
    source.id,
    source.source_type,
    source.category,
    source.patrol_target,
    source.municipality_source_type,
    source.url
  ]
    .filter(Boolean)
    .join(" ");

  return X_BLOCKED_PATTERNS.some(function (pattern) {
    return pattern.test(haystack);
  });
}

function filterMunicipalityPatrolSources(sources) {
  return (sources || []).filter(function (source) {
    return !isXRelatedSource(source);
  });
}

module.exports = {
  isXRelatedSource,
  filterMunicipalityPatrolSources
};
