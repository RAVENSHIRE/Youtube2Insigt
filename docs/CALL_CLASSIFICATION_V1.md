# Call Classification v1

Call Classification separates coverage from measurable investment calls. It is
applied per extracted company and never changes the immutable source transcript.

| Type | Required meaning | Performance eligible |
|---|---|---|
| `mention` | company is named or described without a creator view or action | no |
| `view` | creator expresses a bullish, neutral or bearish view without an explicit action | no |
| `actionable` | creator explicitly says buy, add, hold, reduce or sell | yes |
| `targeted` | actionable call plus an explicit price target and time horizon | yes |

## Enforcement

Gemini extracts `call_type`, `call_confidence`, action, targets, horizon and
evidence. Deterministic backend rules then enforce the eligibility contract:

- `watch` and `none` cannot become actionable;
- sentiment alone never creates an action;
- a reported third-party analyst recommendation is not a creator action;
- targeted calls are downgraded unless action, target and horizon are present;
- explicit actions are always classified as at least actionable;
- only actionable and targeted calls set `performance_eligible: true`.

New reports use analysis schema version 7. Existing reports remain unchanged on
disk and receive a transparent `legacy_rules` classification only in API output.
This lets the UI display one consistent vocabulary without rewriting historical
evidence.
