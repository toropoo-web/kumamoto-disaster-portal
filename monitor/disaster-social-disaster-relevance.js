"use strict";

const DISASTER_RELEVANCE_TERMS = [
  "令和8年熊本地震",
  "令和８年熊本地震",
  "#令和8年熊本地震",
  "熊本地震",
  "地震",
  "震度",
  "被災",
  "災害",
  "支援",
  "救援",
  "給水",
  "断水",
  "炊き出し",
  "食料配布",
  "食料",
  "支援物資",
  "物資",
  "入浴",
  "風呂",
  "シャワー",
  "無料開放",
  "無料提供",
  "避難",
  "避難所",
  "車中泊",
  "Wi-Fi",
  "ワイファイ",
  "充電",
  "電気",
  "製氷",
  "氷",
  "冷却",
  "ペット",
  "迷子",
  "復旧",
  "ボランティア",
  "ボランティア募集",
  "被害",
  "被災地",
  "安否",
  "井戸水",
  "生活用水",
  "飲料水",
  "トイレ",
  "仮設",
  "避難生活"
];

const NOISE_EXCLUSION_TERMS = [
  "アフィリエイト",
  "アフィ",
  "Amazon",
  "アマゾン",
  "楽天",
  "通販",
  "PR案件",
  "案件紹介",
  "ゲーム実況",
  "ゲーム紹介",
  "Steam",
  "PlayStation",
  "PS5",
  "Switch",
  "任天堂",
  "攻略",
  "レベル上げ",
  "ガチャ",
  "観光スポット",
  "旅行記",
  "ホテル予約",
  "お得情報",
  "割引コード",
  "クーポンコード"
];

function normalizeText(text) {
  return String(text || "")
    .replace(/\u3000/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildEntryHaystack(entry) {
  return normalizeText(
    [entry && entry.title, entry && entry.content, entry && entry.summary]
      .filter(Boolean)
      .join(" ")
  );
}

function hasDisasterRelevance(text) {
  const haystack = normalizeText(text);
  if (!haystack) {
    return false;
  }
  return DISASTER_RELEVANCE_TERMS.some(function (term) {
    return haystack.indexOf(term) !== -1;
  });
}

function isNoiseContent(text) {
  const haystack = normalizeText(text);
  if (!haystack) {
    return false;
  }
  return NOISE_EXCLUSION_TERMS.some(function (term) {
    return haystack.indexOf(term) !== -1;
  });
}

function evaluateDisasterRelevance(text) {
  const haystack = normalizeText(text);
  if (!haystack) {
    return { pass: false, reason: "NOT_DISASTER_RELEVANT" };
  }
  const disasterRelevant = hasDisasterRelevance(haystack);
  const noise = isNoiseContent(haystack);
  if (noise && !disasterRelevant) {
    return { pass: false, reason: "NOISE_EXCLUDED" };
  }
  if (!disasterRelevant) {
    return { pass: false, reason: "NOT_DISASTER_RELEVANT" };
  }
  return { pass: true, reason: "DISASTER_RELEVANT" };
}

function isDisasterRelevantEntry(entry) {
  return evaluateDisasterRelevance(buildEntryHaystack(entry)).pass;
}

function isDisasterRelevantPostText(text) {
  return evaluateDisasterRelevance(text).pass;
}

module.exports = {
  DISASTER_RELEVANCE_TERMS,
  NOISE_EXCLUSION_TERMS,
  hasDisasterRelevance,
  isNoiseContent,
  evaluateDisasterRelevance,
  isDisasterRelevantEntry,
  isDisasterRelevantPostText,
  buildEntryHaystack
};
