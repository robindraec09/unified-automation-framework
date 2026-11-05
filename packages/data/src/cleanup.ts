import { logger } from '@qa/core';

const log = logger('cleanup');
type Undo = { label: string; run: () => Promise<unknown> };

/**
 * Records every entity a test creates and removes it in teardown (LIFO),
 * even when the test fails. Exposed to tests as the `cleanup` fixture.
 */
export class CleanupRegistry {
  private items: Undo[] = [];

  add(label: string, run: () => Promise<unknown>) {
    this.items.push({ label, run });
  }

  async runAll() {
    for (const item of this.items.reverse()) {
      try {
        await item.run();
      } catch (err) {
        log.warn(`cleanup failed: ${item.label}`, { err: String(err) });
      }
    }
    this.items = [];
  }
}
