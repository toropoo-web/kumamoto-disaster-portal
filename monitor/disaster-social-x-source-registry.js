"use strict";

const X_COMMUNITY_SOURCE_REGISTRY = {
  "SRC-MUN-KM001": { municipality: "熊本市", source_id: "SOC-LOCAL-003" },
  "SRC-MUN-KM005": { municipality: "八代市", source_id: "SOC-LOCAL-002" },
  "SRC-MUN-KM006": { municipality: "人吉市", source_id: "SOC-LOCAL-001" },
  "SRC-MUN-KM009": { municipality: "合志市", source_id: "SOC-LOCAL-001" }
};

const DEFAULT_X_SOURCE_ID = "SOC-LOCAL-001";

module.exports = {
  X_COMMUNITY_SOURCE_REGISTRY,
  DEFAULT_X_SOURCE_ID
};
