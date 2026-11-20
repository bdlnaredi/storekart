plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.bdlnaredi.storekart"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.bdlnaredi.storekart"
        minSdk = 26          // Android 8.0+
        targetSdk = 34
        // GitHub builds number themselves so each new APK installs over the old one
        versionCode = (System.getenv("GITHUB_RUN_NUMBER") ?: "1").toInt()
        versionName = "1.0." + (System.getenv("GITHUB_RUN_NUMBER") ?: "0")
    }

    // One shared TEST signing key, so every build can update the app already on the phone.
    // Make your own private key before publishing on the Play Store.
    signingConfigs {
        create("shared") {
            storeFile = file("storekart-test.jks")
            storePassword = "storekart"
            keyAlias = "storekart"
            keyPassword = "storekart"
        }
    }
    buildTypes {
        debug { signingConfig = signingConfigs.getByName("shared") }
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("shared")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures { buildConfig = true }
    lint {
        checkReleaseBuilds = false
        abortOnError = false
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.gms:play-services-location:21.3.0")
}
