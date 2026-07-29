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
  "伝言"
];

const CONTAMINATION_PATTERNS = [
  /2016/,
  /平成28/,
  /H28/,
  /平成２８/
];

const USER_AGENT = "kumamoto-disaster-portal-patrol/1.0";

module.exports = {
  KEYWORDS,
  CONTAMINATION_PATTERNS,
  USER_AGENT,
  FETCH_TIMEOUT_MS: 20000
};
