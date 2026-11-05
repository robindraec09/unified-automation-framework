import type { LoginPage } from '@qa/web';
import type { LoginScreen } from '@qa/mobile';

/**
 * Business flows are written once against an interface and implemented per channel,
 * so the same scenario can run on web and native mobile.
 */
export interface LoginFlow {
  loginAs(user: string, password: string): Promise<void>;
}

export const webLogin = (page: LoginPage): LoginFlow => ({
  loginAs: (u, p) => page.loginAs(u, p),
});

export const mobileLogin = (screen: LoginScreen): LoginFlow => ({
  loginAs: (u, p) => screen.loginAs(u, p),
});
