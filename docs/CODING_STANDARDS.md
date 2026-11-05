# Test coding standards

These apply to every test, hand-written or agent-generated. The framework MCP server serves this file to agents.

## Structure
- Import only from `@qa/test`: `import { test, expect } from '@qa/test';`
- One behaviour per test. Title says the expected outcome, ends with tags: `'adds item to cart @smoke'`.
- Tests call page/screen objects, API clients and flows. No raw locators or driver calls in specs.
- Arrange data through APIs or builders (`PostBuilder`, `OrderBuilder`) and register cleanup with `cleanup.add(...)`.

## Locators
- Web: `getByRole` > `getByLabel` / `getByPlaceholder` > `getByTestId` > CSS. Never XPath.
- Mobile: accessibility id (`~id`) > UiAutomator / iOS predicate. Never XPath.
- New locators belong in a page/screen object, not in a spec.

## Waiting and assertions
- No `waitForTimeout` or sleeps. Use web-first assertions (`await expect(locator).toBeVisible()`).
- Assert business outcomes (totals, states, messages), not just visibility.
- API: assert status and schema (`toMatchSchema`) and the business fields that matter.
- ETL: assert counts, totals and row hashes; attach mismatches as CSV.

## Tags
`@smoke` `@regression` `@contract` `@functional` `@negative` `@a11y` `@device` `@etl` `@recon` `@dq` `@quarantine`

## Agent-generated changes
- Arrive as PRs labelled `ai-generated`; same review and CI gates as human code.
- The healer may change locators and waits only. Any change to an assertion needs reviewer sign-off.
- Agents never run against production and never receive real secrets or PII.
