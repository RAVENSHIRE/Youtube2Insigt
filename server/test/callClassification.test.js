const assert = require("node:assert/strict");
const test = require("node:test");
const {
  classifyCall,
  normalizeConfidence
} = require("../classification/callClassification");

test("keeps a casual mention out of performance tracking", () => {
  const result = classifyCall({
    call_type: "mention",
    action: "none",
    sentiment: "neutral",
    thesis: "Nvidia wurde in einer Aufzählung genannt.",
    price_targets: []
  });

  assert.equal(result.call_type, "mention");
  assert.equal(result.performance_eligible, false);
  assert.equal(result.call_classification_source, "model_plus_rules");
});

test("keeps a directional view separate from an action", () => {
  const result = classifyCall({
    call_type: "view",
    action: "watch",
    sentiment: "bull",
    thesis: "Der Creator erwartet steigende Nachfrage.",
    price_targets: []
  });

  assert.equal(result.call_type, "view");
  assert.equal(result.performance_eligible, false);
});

test("makes an explicit creator action performance eligible", () => {
  const result = classifyCall({
    call_type: "view",
    action: "buy",
    sentiment: "bull",
    price_targets: []
  });

  assert.equal(result.call_type, "actionable");
  assert.equal(result.performance_eligible, true);
});

test("requires action, target and horizon for a targeted call", () => {
  const targeted = classifyCall({
    call_type: "targeted",
    action: "buy",
    price_targets: [{ value: 220, currency: "USD" }],
    time_horizon: "12 months"
  });
  const incomplete = classifyCall({
    call_type: "targeted",
    action: "buy",
    price_targets: [{ value: 220, currency: "USD" }]
  });

  assert.equal(targeted.call_type, "targeted");
  assert.equal(targeted.performance_eligible, true);
  assert.equal(incomplete.call_type, "actionable");
});

test("normalizes legacy reports without rewriting stored data", () => {
  const legacyView = classifyCall({
    sentiment: "bear",
    action: "none",
    thesis: "Margendruck bleibt hoch.",
    price_targets: []
  });
  const legacyMention = classifyCall({
    sentiment: "neutral",
    action: "none",
    thesis: null,
    price_targets: []
  });

  assert.equal(legacyView.call_type, "view");
  assert.equal(legacyView.call_classification_source, "legacy_rules");
  assert.equal(legacyMention.call_type, "mention");
});

test("clamps model confidence to the supported range", () => {
  assert.equal(normalizeConfidence(1.4), 1);
  assert.equal(normalizeConfidence(-0.2), 0);
  assert.equal(normalizeConfidence("0.75"), 0.75);
  assert.equal(normalizeConfidence(null), null);
  assert.equal(normalizeConfidence(undefined), null);
});
