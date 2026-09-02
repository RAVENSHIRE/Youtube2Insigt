const assert = require("node:assert/strict");
const test = require("node:test");
const {
  calculateMaxDrawdown,
  calculatePeakReturn,
  calculateReturn
} = require("../outcomes/outcomeService");

test("calculates current return from publication price", () => {
  assert.equal(calculateReturn(100, 127.7), 27.7);
});

test("calculates peak return from daily highs", () => {
  const result = calculatePeakReturn(100, [
    { high: 112, close: 108 },
    { high: 135, close: 130 }
  ], 125);
  assert.equal(result.peak_price, 135);
  assert.equal(result.peak_return_pct, 35);
});

test("calculates maximum peak-to-trough drawdown", () => {
  const drawdown = calculateMaxDrawdown(100, [
    { close: 120 },
    { close: 90 },
    { close: 110 }
  ], 105);
  assert.equal(drawdown, -25);
});

test("rejects invalid prices instead of emitting misleading outcomes", () => {
  assert.throws(() => calculateReturn(0, 100), /entryPrice/u);
  assert.throws(() => calculateReturn(100, null), /currentPrice/u);
});
