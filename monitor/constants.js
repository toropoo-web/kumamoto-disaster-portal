"use strict";

const KEYWORDS = [
  "避難",
  "避難所",
  "給水",
  "断水",
  "復旧",
  "開設",
  "閉鎖",
  "支援",
  "災害",
  "通信",
  "Wi-Fi",
  "伝言",
  "Web171",
  "公衆電話",
  "災害支援"
];

const CONTAMINATION_PATTERNS = [
  /2016/,
  /平成28/,
  /H28/,
  /平成２８/
];

const USER_AGENT = "kumamoto-disaster-portal-patrol/1.0";

const SUGGESTED_REVIEW_LOCATION_LIST = "LOCATION_LIST";
const SUGGESTED_REVIEW_EMERGENCY_INFO = "EMERGENCY_INFO";
const SUGGESTED_REVIEW_INFRASTRUCTURE_STATUS = "INFRASTRUCTURE_STATUS";

const LOCATION_LIST_REVIEW_SOURCE_IDS = new Set([
  "KM001-kumamoto-shelter",
  "KM002-uto-water",
  "KM003-uki-emergency",
  "KM006-hitoyoshi-shelter",
  "KM008-mashiki-shelter",
  "KM010-mifune-shelter",
  "KM011-kikuyo-water",
  "KM012-kashima-water",
  "KM013-kikuchi-shelter"
]);

function isLocationListReviewSource(source) {
  if (!source || !source.id) {
    return false;
  }
  if (LOCATION_LIST_REVIEW_SOURCE_IDS.has(source.id)) {
    return true;
  }
  if (source.suggestedReview === SUGGESTED_REVIEW_LOCATION_LIST) {
    return true;
  }
  return source.relatedPublicTarget === "disaster_locations";
}

function isEmergencyInfoReviewSource(source) {
  if (!source) {
    return false;
  }
  if (source.suggestedReview === SUGGESTED_REVIEW_EMERGENCY_INFO) {
    return true;
  }
  return source.relatedPublicTarget === "phase1_updates" && source.category === "emergency";
}

function isInfrastructureStatusReviewSource(source) {
  if (!source) {
    return false;
  }
  if (source.suggestedReview === SUGGESTED_REVIEW_INFRASTRUCTURE_STATUS) {
    return true;
  }
  return source.relatedPublicTarget === "infrastructure_status";
}

module.exports = {
  KEYWORDS,
  CONTAMINATION_PATTERNS,
  USER_AGENT,
  FETCH_TIMEOUT_MS: 20000,
  SUGGESTED_REVIEW_LOCATION_LIST,
  SUGGESTED_REVIEW_EMERGENCY_INFO,
  SUGGESTED_REVIEW_INFRASTRUCTURE_STATUS,
  LOCATION_LIST_REVIEW_SOURCE_IDS,
  isLocationListReviewSource,
  isEmergencyInfoReviewSource,
  isInfrastructureStatusReviewSource
};
