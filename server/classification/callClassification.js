const CALL_CLASSIFICATION_VERSION = 1;
const CALL_TYPES = new Set(["mention", "view", "actionable", "targeted"]);
const ACTIONABLE_ACTIONS = new Set(["buy", "add", "hold", "reduce", "sell"]);

function cleanString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeConfidence(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const confidence = Number(value);
  return Number.isFinite(confidence)
    ? Math.min(1, Math.max(0, confidence))
    : null;
}

function hasDirectionalView(company = {}) {
  return ["bull", "bear"].includes(company.sentiment) || Boolean(cleanString(company.thesis));
}

function classifyCall(company = {}) {
  const requestedType = CALL_TYPES.has(company.call_type) ? company.call_type : null;
  const action = String(company.action || "none").toLowerCase();
  const actionable = ACTIONABLE_ACTIONS.has(action);
  const hasTarget = Array.isArray(company.price_targets) && company.price_targets.length > 0;
  const hasHorizon = Boolean(cleanString(company.time_horizon));
  let callType;

  if (actionable && hasTarget && hasHorizon) {
    callType = "targeted";
  } else if (actionable) {
    callType = "actionable";
  } else if (["mention", "view"].includes(requestedType)) {
    callType = requestedType;
  } else {
    callType = hasDirectionalView(company) ? "view" : "mention";
  }

  return {
    call_type: callType,
    call_confidence: normalizeConfidence(company.call_confidence),
    call_classification_version: CALL_CLASSIFICATION_VERSION,
    call_classification_source: requestedType ? "model_plus_rules" : "legacy_rules",
    performance_eligible: ["actionable", "targeted"].includes(callType)
  };
}

module.exports = {
  ACTIONABLE_ACTIONS,
  CALL_CLASSIFICATION_VERSION,
  CALL_TYPES,
  classifyCall,
  normalizeConfidence
};
