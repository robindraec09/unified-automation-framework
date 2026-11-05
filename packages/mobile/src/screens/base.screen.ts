/**
 * Base for screen objects. One interface, platform-specific selectors behind it.
 * Selector policy: accessibility id (~) first, then UiAutomator / iOS predicate. No XPath.
 */
export type PlatformSelector = { android: string; ios: string };

export abstract class BaseScreen {
  constructor(protected readonly driver: WebdriverIO.Browser) {}

  protected get isAndroid() {
    return this.driver.isAndroid;
  }

  protected el(selector: string | PlatformSelector) {
    const s = typeof selector === 'string' ? selector : this.isAndroid ? selector.android : selector.ios;
    return this.driver.$(s);
  }

  async waitFor(selector: string | PlatformSelector, timeout = 15_000) {
    await this.el(selector).waitForDisplayed({ timeout });
  }
}
