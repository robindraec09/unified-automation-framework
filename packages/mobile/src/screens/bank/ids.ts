/** Harbourline Mobile's application id (apps/harbourline-android). */
export const HARBOURLINE_PACKAGE = 'com.harbourline.mobile';

/** UiAutomator selector for one of the app's Android resource ids, e.g. harbourlineId('login_button'). */
export const harbourlineId = (id: string) =>
  `android=new UiSelector().resourceId("${HARBOURLINE_PACKAGE}:id/${id}")`;
