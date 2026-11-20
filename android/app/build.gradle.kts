import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// ---- Your store, built into the apps (never written in this public repository) ----
// GitHub:          repository Settings → Secrets and variables → Actions → secret STORE_URL (and variable STORE_NAME)
// Android Studio:  add  storekart.url=https://shop.example.com  and  storekart.name=My Shop  to android/local.properties
// Left empty, the apps ask for the store address the first time they open.
val localProps = Properties().apply {
    val f = rootProject.file("local.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}
fun setting(env: String, prop: String, default: String = ""): String =
    (System.getenv(env)?.takeIf { it.isNotBlank() } ?: localProps.getProperty(prop) ?: default).trim()

val storeUrl = setting("STORE_URL", "storekart.url")
val storeName = setting("STORE_NAME", "storekart.name", "StoreKart")
val appId = setting("STORE_APP_ID", "storekart.appId", "com.bdlnaredi.storekart")
fun quoted(s: String) = "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"") + "\""

android {
    namespace = "com.bdlnaredi.storekart"
    compileSdk = 35

    defaultConfig {
        applicationId = appId
        minSdk = 26          // Android 8.0+
        targetSdk = 34
        // GitHub builds number themselves so each new APK installs over the old one
        versionCode = (System.getenv("GITHUB_RUN_NUMBER") ?: "1").toInt()
        versionName = "1.0." + (System.getenv("GITHUB_RUN_NUMBER") ?: "0")
        buildConfigField("String", "STORE_URL", quoted(storeUrl))
    }

    // Two apps from the same code
    flavorDimensions += "app"
    productFlavors {
        create("customer") {
            dimension = "app"
            resValue("string", "app_name", storeName)
            buildConfigField("boolean", "STAFF", "false")
        }
        create("staff") {
            dimension = "app"
            applicationIdSuffix = ".staff"
            resValue("string", "app_name", "$storeName Staff")
            buildConfigField("boolean", "STAFF", "true")
        }
    }

    // Signing: your private key from GitHub secrets (STOREKART_KEYSTORE_B64 + STOREKART_KEYSTORE_PASSWORD),
    // otherwise the public TEST key in this repo — fine for trying things, not for giving to customers.
    val privateKey = System.getenv("STOREKART_KEYSTORE")?.takeIf { it.isNotBlank() && file(it).exists() }
    signingConfigs {
        create("shared") {
            storeFile = file("storekart-test.jks")
            storePassword = "storekart"
            keyAlias = "storekart"
            keyPassword = "storekart"
        }
        if (privateKey != null) create("private") {
            storeFile = file(privateKey)
            storePassword = System.getenv("STOREKART_KEYSTORE_PASSWORD")
            keyAlias = System.getenv("STOREKART_KEY_ALIAS")?.takeIf { it.isNotBlank() } ?: "storekart"
            keyPassword = System.getenv("STOREKART_KEY_PASSWORD")?.takeIf { it.isNotBlank() } ?: System.getenv("STOREKART_KEYSTORE_PASSWORD")
        }
    }
    buildTypes {
        debug { signingConfig = signingConfigs.getByName("shared") }
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName(if (privateKey != null) "private" else "shared")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures {
        buildConfig = true
        resValues = true
    }
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
