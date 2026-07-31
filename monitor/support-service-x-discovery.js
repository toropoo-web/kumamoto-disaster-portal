"use strict";

const SUPPORT_STATE_KEYWORDS = [
  "食事提供します",
  "物資配布します",
  "被災者向け無料入浴",
  "被災者向け入浴",
  "温泉無料開放",
  "シャワー利用できます",
  "お風呂使えます",
  "水提供します",
  "炊き出しします",
  "支援物資配布",
  "無料開放",
  "無料入浴",
  "無料風呂",
  "無料シャワー",
  "無料食事",
  "食事提供",
  "食料配布",
  "物資配布",
  "利用できます",
  "利用可能",
  "使えますよ",
  "使えます",
  "対応します",
  "支援します",
  "受け入れます",
  "ご利用ください",
  "開始しました",
  "受け入れ",
  "あります",
  "できます",
  "配布",
  "無料",
  "開放",
  "提供"
];

const COMPOUND_DISCOVERY_PHRASES = [
  "被災者向け無料入浴",
  "被災者向け入浴",
  "温泉無料開放",
  "シャワー利用できます",
  "お風呂使えます",
  "支援物資配布",
  "物資配布します",
  "食事提供します",
  "水提供します",
  "炊き出しします",
  "炊き出し提供",
  "無料シャワー",
  "無料入浴",
  "無料風呂",
  "無料開放",
  "車中泊できます",
  "車中泊可能",
  "駐車場開放",
  "井戸水あります",
  "井戸水提供",
  "休憩場所提供",
  "場所提供",
  "個室提供",
  "部屋提供",
  "ペット預かり",
  "ペット受入"
];

const TOPIC_KEYWORD_GROUPS = {
  BATH: [
    "入浴施設",
    "シャワー室",
    "体を洗える",
    "温泉開放",
    "無料シャワー",
    "風呂無料",
    "無料風呂",
    "無料入浴",
    "入浴支援",
    "お風呂",
    "風呂",
    "入浴",
    "シャワー",
    "温泉",
    "銭湯",
    "浴場"
  ],
  WATER: [
    "井戸水あります",
    "飲料水提供",
    "生活用水",
    "水配布",
    "井戸水",
    "飲料水",
    "地下水",
    "給水",
    "水提供",
    "水"
  ],
  VEHICLE: [
    "車中泊できます",
    "車中泊可能",
    "駐車場開放",
    "駐車場提供",
    "無料駐車場",
    "車両受入",
    "キャンピングカー",
    "車で泊まる",
    "車中泊",
    "駐車場",
    "車泊"
  ],
  SPACE: [
    "休憩スペース",
    "宿泊スペース",
    "休憩場所",
    "個室提供",
    "部屋提供",
    "待機場所",
    "場所提供",
    "スペース",
    "個室",
    "休憩",
    "仮眠",
    "部屋"
  ],
  FOOD: [
    "炊き出しします",
    "食事提供",
    "食料提供",
    "弁当配布",
    "無料食事",
    "食料配布",
    "炊き出し",
    "弁当"
  ],
  SUPPLIES: [
    "日用品配布",
    "衣類配布",
    "毛布配布",
    "支援物資",
    "物資配布",
    "生活用品",
    "物資"
  ],
  PET: [
    "ペット預かり",
    "ペット受入",
    "ペット対応",
    "ペット",
    "預かり",
    "犬",
    "猫"
  ],
  TOILET: [
    "仮設トイレ",
    "トイレ開放",
    "水洗トイレ",
    "お手洗い",
    "トイレ"
  ]
};

const DISCOVERY_EXCLUSION_PATTERNS = [
  /通常営業/,
  /割引/,
  /クーポン/,
  /キャンペーン/,
  /期間限定セール/,
  /営業しています/,
  /営業中です/
];

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function findMatchedKeywords(text, keywords) {
  const normalized = normalizeText(text);
  const sorted = (keywords || []).slice().sort(function (left, right) {
    return right.length - left.length;
  });
  const matched = [];
  sorted.forEach(function (keyword) {
    if (keyword && normalized.indexOf(keyword) !== -1) {
      matched.push(keyword);
    }
  });
  return matched;
}

function collectTopicKeywords(text) {
  const matched = [];
  Object.keys(TOPIC_KEYWORD_GROUPS).forEach(function (group) {
    findMatchedKeywords(text, TOPIC_KEYWORD_GROUPS[group]).forEach(function (keyword) {
      if (matched.indexOf(keyword) === -1) {
        matched.push(keyword);
      }
    });
  });
  return matched;
}

function hasStrongSupportSignal(text, supportMatches) {
  const strongSignals = [
    "無料開放",
    "温泉無料開放",
    "無料入浴",
    "無料風呂",
    "無料シャワー",
    "無料食事",
    "被災者向け",
    "支援します",
    "対応します",
    "受け入れます",
    "受け入れ",
    "利用できます",
    "利用可能",
    "使えます",
    "あります",
    "できます",
    "開始しました",
    "提供",
    "開放",
    "配布"
  ];
  return (supportMatches || []).some(function (keyword) {
    return strongSignals.indexOf(keyword) !== -1;
  });
}

function isNormalBusinessExclusion(text) {
  const normalized = normalizeText(text);
  if (/営業しています|営業中です/.test(normalized)) {
    return !/無料|開放|被災|支援|提供/.test(normalized);
  }
  if (/通常営業/.test(normalized)) {
    return !/無料開放|温泉無料開放|被災|支援/.test(normalized);
  }
  return false;
}

function isExcludedDiscoveryText(text) {
  const normalized = normalizeText(text);
  if (isNormalBusinessExclusion(normalized)) {
    return true;
  }
  for (let i = 0; i < DISCOVERY_EXCLUSION_PATTERNS.length; i += 1) {
    if (DISCOVERY_EXCLUSION_PATTERNS[i].test(normalized)) {
      const evaluation = evaluateXDiscoveryText(normalized);
      if (!evaluation.discoverable || !evaluation.compound_match) {
        return true;
      }
    }
  }
  return false;
}

function evaluateXDiscoveryText(text) {
  const normalized = normalizeText(text);
  if (!normalized) {
    return {
      discoverable: false,
      detected_keywords: [],
      support_keywords: [],
      topic_keywords: [],
      compound_match: false,
      reason: "empty_text"
    };
  }

  if (isNormalBusinessExclusion(normalized)) {
    return {
      discoverable: false,
      detected_keywords: [],
      support_keywords: [],
      topic_keywords: [],
      compound_match: false,
      reason: "normal_business"
    };
  }

  const compoundMatches = findMatchedKeywords(normalized, COMPOUND_DISCOVERY_PHRASES);
  const supportMatches = findMatchedKeywords(normalized, SUPPORT_STATE_KEYWORDS);
  const topicMatches = collectTopicKeywords(normalized);
  const detectedKeywords = [];
  compoundMatches.forEach(function (keyword) {
    if (detectedKeywords.indexOf(keyword) === -1) {
      detectedKeywords.push(keyword);
    }
  });
  supportMatches.forEach(function (keyword) {
    if (detectedKeywords.indexOf(keyword) === -1) {
      detectedKeywords.push(keyword);
    }
  });
  topicMatches.forEach(function (keyword) {
    if (detectedKeywords.indexOf(keyword) === -1) {
      detectedKeywords.push(keyword);
    }
  });

  const compoundMatch = compoundMatches.length > 0;
  const combinationMatch =
    supportMatches.length > 0 &&
    topicMatches.length > 0 &&
    hasStrongSupportSignal(normalized, supportMatches);
  const discoverable = compoundMatch || combinationMatch;

  return {
    discoverable: discoverable,
    detected_keywords: detectedKeywords,
    support_keywords: supportMatches,
    topic_keywords: topicMatches,
    compound_match: compoundMatch,
    reason: discoverable ? "matched" : "single_word_or_no_combination"
  };
}

function isDiscoverableSupportServicePost(post) {
  const text = normalizeText(post && post.text);
  if (!text) {
    return false;
  }
  if (isExcludedDiscoveryText(text)) {
    return false;
  }
  return evaluateXDiscoveryText(text).discoverable;
}

function matchesDiscoveryKeyword(text) {
  const evaluation = evaluateXDiscoveryText(text);
  const primaryKeyword =
    evaluation.detected_keywords.find(function (keyword) {
      return ["無料開放", "無料入浴", "無料風呂", "無料シャワー", "温泉無料開放"].indexOf(keyword) !== -1;
    }) || evaluation.support_keywords[0] || null;
  const secondaryKeyword = evaluation.topic_keywords[0] || null;
  const keyword = primaryKeyword || secondaryKeyword;
  return {
    matched: evaluation.discoverable,
    keyword: keyword,
    level: primaryKeyword ? "PRIMARY" : secondaryKeyword ? "SECONDARY" : null,
    detected_keywords: evaluation.detected_keywords
  };
}

module.exports = {
  SUPPORT_STATE_KEYWORDS,
  COMPOUND_DISCOVERY_PHRASES,
  TOPIC_KEYWORD_GROUPS,
  DISCOVERY_EXCLUSION_PATTERNS,
  normalizeText,
  findMatchedKeywords,
  collectTopicKeywords,
  evaluateXDiscoveryText,
  isNormalBusinessExclusion,
  isExcludedDiscoveryText,
  isDiscoverableSupportServicePost,
  matchesDiscoveryKeyword
};
