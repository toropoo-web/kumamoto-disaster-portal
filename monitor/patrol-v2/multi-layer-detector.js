"use strict";

const SIGNAL_WEIGHTS = {
  contentHash: 40,
  regionHash: 35,
  title: 15,
  pageUpdatedAt: 10,
  feedFingerprint: 20
};

function normalizeSignal(value) {
  if (!value) {
    return false;
  }
  return true;
}

function detectMultiLayerChange(previous, current) {
  const signals = [];
  let score = 0;

  if (!current || !current.reachable) {
    return {
      changed: false,
      failed: true,
      score: 0,
      signals: [{ type: "URL_UNREACHABLE", weight: 0 }],
      primaryChangeType: "URL_UNREACHABLE"
    };
  }

  if (!previous) {
    return {
      changed: false,
      failed: false,
      score: 0,
      signals: [{ type: "BASELINE_CREATED", weight: 0 }],
      primaryChangeType: null
    };
  }

  if (previous.contentHash !== current.contentHash) {
    signals.push({ type: "CONTENT_HASH", weight: SIGNAL_WEIGHTS.contentHash });
    score += SIGNAL_WEIGHTS.contentHash;
  }

  if (
    current.regionHash &&
    previous.regionHash &&
    previous.regionHash !== current.regionHash
  ) {
    signals.push({ type: "REGION_HASH", weight: SIGNAL_WEIGHTS.regionHash });
    score += SIGNAL_WEIGHTS.regionHash;
  }

  if (previous.title !== current.title && current.title) {
    signals.push({ type: "TITLE", weight: SIGNAL_WEIGHTS.title });
    score += SIGNAL_WEIGHTS.title;
  }

  if (
    previous.pageUpdatedAt !== current.pageUpdatedAt &&
    normalizeSignal(current.pageUpdatedAt)
  ) {
    signals.push({ type: "PAGE_UPDATED_AT", weight: SIGNAL_WEIGHTS.pageUpdatedAt });
    score += SIGNAL_WEIGHTS.pageUpdatedAt;
  }

  const prevFeed = previous.feedFingerprint || "";
  const currFeed = current.feedFingerprint || "";
  if (currFeed && prevFeed && prevFeed !== currFeed) {
    signals.push({ type: "FEED_FINGERPRINT", weight: SIGNAL_WEIGHTS.feedFingerprint });
    score += SIGNAL_WEIGHTS.feedFingerprint;
  }

  let primaryChangeType = null;
  if (signals.length) {
    primaryChangeType = signals[0].type;
    if (signals.some(function (s) { return s.type === "REGION_HASH"; })) {
      primaryChangeType = "CONTENT_CHANGED";
    } else if (signals.some(function (s) { return s.type === "TITLE"; })) {
      primaryChangeType = "TITLE_CHANGED";
    } else if (signals.some(function (s) { return s.type === "FEED_FINGERPRINT"; })) {
      primaryChangeType = "FEED_CHANGED";
    }
  }

  return {
    changed: score > 0,
    failed: false,
    score: score,
    signals: signals,
    primaryChangeType: primaryChangeType
  };
}

module.exports = {
  detectMultiLayerChange,
  SIGNAL_WEIGHTS
};
