# Builds the Harbourline Mobile APK. Build context: apps/harbourline-android
#   docker compose run --rm --build android-build      (writes build/apps/android/harbourline-mobile.apk)
# Gradle 8.10.2 + JDK 17 + Android SDK 35 (matches AGP 8.7.3 in build.gradle.kts).

FROM gradle:8.10.2-jdk17 AS sdk
ENV ANDROID_HOME=/opt/android-sdk \
    ANDROID_SDK_ROOT=/opt/android-sdk
RUN apt-get update && apt-get install -y --no-install-recommends unzip curl \
    && rm -rf /var/lib/apt/lists/*
# Android command-line tools, then the exact SDK packages the app compiles against.
# The licences are the standard Android SDK terms, accepted for this build image.
RUN mkdir -p "$ANDROID_HOME/cmdline-tools" \
    && curl -fsSL https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip -o /tmp/tools.zip \
    && unzip -q /tmp/tools.zip -d "$ANDROID_HOME/cmdline-tools" \
    && mv "$ANDROID_HOME/cmdline-tools/cmdline-tools" "$ANDROID_HOME/cmdline-tools/latest" \
    && rm /tmp/tools.zip \
    && yes | "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" --licenses > /dev/null \
    && "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" --install "platforms;android-35" "build-tools;35.0.0" "platform-tools" > /dev/null

FROM sdk AS build
WORKDIR /src
COPY settings.gradle.kts build.gradle.kts gradle.properties ./
COPY app app
# BANK_URL is how the app reaches Harbourline from the emulator (10.0.2.2 = the emulator's host)
ARG BANK_URL=http://10.0.2.2:4000
RUN gradle --no-daemon --console=plain assembleDebug -PbankUrl="$BANK_URL" \
    && cp app/build/outputs/apk/debug/app-debug.apk /harbourline-mobile.apk

# Tiny runtime stage: only copies the APK out to a mounted folder
FROM busybox:1.36
COPY --from=build /harbourline-mobile.apk /harbourline-mobile.apk
CMD ["sh", "-c", "mkdir -p /out && cp /harbourline-mobile.apk /out/ && ls -l /out/harbourline-mobile.apk"]
