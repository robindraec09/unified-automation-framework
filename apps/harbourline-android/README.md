# Harbourline Mobile (Android)

A small native Android app for the fictional Harbourline Bank, so the framework's mobile channel tests
our own system end to end: the app talks to the same bank API and database as the web UI.
Kotlin, Android platform APIs only (no AndroidX, no third-party libraries). The sign-in screen says it is a demo bank.

| Screen   | What it does                                  | Resource ids used by tests                                                                                                                      |
| -------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Sign in  | Customer ID + password                        | `customer_id`, `password`, `login_button`, `login_error`, `login_title`                                                                         |
| Accounts | Accounts with balances, net position, log out | `accounts_title`, `customer_name`, `account_row` (one per account), `account_balance`, `net_position`, `transfer_button`, `logout_button`       |
| Transfer | Between own accounts, with a receipt          | `from_spinner`, `to_spinner`, `amount`, `description`, `transfer_submit`, `transfer_error`, `transfer_receipt`, `receipt_summary`, `receipt_id` |

Tests find elements by **Android resource id**, not by test ids stuffed into `contentDescription`:
TalkBack reads content descriptions aloud, so they stay human (each account row reads
"Everyday Account, account 12345678, balance $1,000.00", which tests also use to find the row).

## Sign-in: OAuth 2.0 with PKCE

The app is a **public client** (`harbour-mobile`, no secret in the APK). It creates a PKCE verifier,
submits the sign-in form to `/oauth/authorize` without following the redirect, takes the code from the
`com.harbourline.mobile://oauth/callback?code=...` redirect, checks `state`, and exchanges the code with the
verifier at `/oauth/token`. Tokens stay in memory; closing the app signs out. Transfers send an
`Idempotency-Key` per form view, so a double tap can never pay twice.

## Build (in Docker)

```bash
pnpm mobile:build        # or: docker compose --profile mobile run --rm --build android-build
```

Produces `build/apps/android/harbourline-mobile.apk`. The image is Gradle 8.10.2 + JDK 17 + Android SDK 35
(AGP 8.7.3, Kotlin 2.0.21); SDK and dependency layers are cached, so rebuilds only recompile the app.
The first build downloads the SDK and takes about 10 to 15 minutes.

The app calls `http://10.0.2.2:4000`, the emulator's alias for its host. In the Docker stack the
`android-proxy` container forwards that port to the `bank-app` service. To point at another bank, build
with `--build-arg BANK_URL=...` (cleartext HTTP is allowed only for `10.0.2.2` and `localhost`, see
`res/xml/network_security_config.xml`).

## Run and test (in Docker)

```bash
pnpm mobile:up           # APK + KVM + Android 14 emulator + Appium; first boot takes up to ~10 minutes
pnpm mobile:test         # bank-android suite in the tests container
```

Watch the emulator at <http://localhost:6080>. Details and troubleshooting: the root README, "Mobile".
