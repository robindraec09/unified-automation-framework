plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Where the app finds Harbourline Bank. 10.0.2.2 is the emulator's alias for its host; in the Docker
// stack a proxy on the emulator container forwards :4000 to the bank-app service.
val bankUrl: String = (project.findProperty("bankUrl") as String?) ?: "http://10.0.2.2:4000"

android {
    namespace = "com.harbourline.mobile"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.harbourline.mobile"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"
        buildConfigField("String", "BANK_URL", "\"$bankUrl\"")
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}
