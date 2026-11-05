import { BaseScreen } from './base.screen';

/** Example screen. Replace accessibility ids with those of your app. */
export class LoginScreen extends BaseScreen {
  private readonly username = '~username-input';
  private readonly password = '~password-input';
  private readonly submit = '~login-button';
  private readonly home = {
    android: 'android=new UiSelector().resourceId("home-title")',
    ios: '-ios predicate string:name == "home-title"',
  };

  async loginAs(user: string, password: string) {
    await this.el(this.username).setValue(user);
    await this.el(this.password).setValue(password);
    await this.el(this.submit).click();
  }

  async isHomeVisible() {
    await this.waitFor(this.home);
    return this.el(this.home).isDisplayed();
  }
}
