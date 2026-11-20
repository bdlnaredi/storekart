package com.bdlnaredi.storekart

import android.Manifest
import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.print.PrintAttributes
import android.print.PrintManager
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.GeolocationPermissions
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.ProgressBar
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import org.json.JSONObject

/** The store (customer shop or staff screens) inside an app window, plus phone features the website can't do. */
class MainActivity : AppCompatActivity() {

    companion object {
        val LOCATION_PERMS = arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)
    }

    lateinit var web: WebView
    private lateinit var root: FrameLayout
    private lateinit var progress: ProgressBar
    private var errorView: View? = null
    private var failed = false
    private lateinit var storeUrl: String
    private var loadedStart = ""

    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var geoPrompt: Pair<String, GeolocationPermissions.Callback>? = null
    private var afterLocationOk: (() -> Unit)? = null
    private var afterLocationDenied: (() -> Unit)? = null

    private val pickImage = registerForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        fileCallback?.onReceiveValue(if (uri != null) arrayOf(uri) else null)
        fileCallback = null
    }

    private val askLocation = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { res ->
        val ok = res[Manifest.permission.ACCESS_FINE_LOCATION] == true || res[Manifest.permission.ACCESS_COARSE_LOCATION] == true
        geoPrompt?.let { (origin, cb) -> cb.invoke(origin, ok, false) }
        geoPrompt = null
        val yes = afterLocationOk; val no = afterLocationDenied
        afterLocationOk = null; afterLocationDenied = null
        if (ok) yes?.invoke() else {
            no?.invoke()
            Toast.makeText(this, "Location permission is needed for live delivery tracking", Toast.LENGTH_LONG).show()
        }
    }

    private val askNotifications = registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val saved = Prefs.storeUrl(this)
        if (saved == null) {
            startActivity(Intent(this, SetupActivity::class.java))
            finish()
            return
        }
        storeUrl = saved

        root = FrameLayout(this)
        web = WebView(this)
        root.addView(web, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        progress = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
            isIndeterminate = true
            visibility = View.GONE
        }
        root.addView(progress, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, Ui.dp(this, 4), Gravity.TOP))
        setContentView(root)
        setupWebView()

        if (BuildConfig.STAFF && Build.VERSION.SDK_INT >= 33 && !Notifier.canPost(this)) { // order alerts are for staff
            askNotifications.launch(Manifest.permission.POST_NOTIFICATIONS)
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (errorView == null && web.canGoBack()) web.goBack()
                else { isEnabled = false; onBackPressedDispatcher.onBackPressed() }
            }
        })

        loadedStart = startUrl()
        if (savedInstanceState != null) web.restoreState(savedInstanceState) else web.loadUrl(loadedStart)
    }

    private fun startUrl(): String = storeUrl + if (Prefs.staffMode(this)) "#/admin" else ""

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        with(web.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            setGeolocationEnabled(true)
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = false
            setSupportMultipleWindows(false)
            javaScriptCanOpenWindowsAutomatically = false
            useWideViewPort = true
            loadWithOverviewMode = true
            userAgentString = "$userAgentString StoreKartApp/${BuildConfig.VERSION_NAME}"
        }
        web.addJavascriptInterface(AppBridge(this), "StoreKartApp")

        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean = handleUrl(request.url)

            override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
                failed = false
                progress.visibility = View.VISIBLE
            }

            override fun onPageFinished(view: WebView, url: String?) {
                progress.visibility = View.GONE
                if (!failed) hideError()
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame) {
                    failed = true
                    showError(error.description?.toString() ?: "Could not load the store")
                }
            }
        }

        web.webChromeClient = object : WebChromeClient() {
            override fun onGeolocationPermissionsShowPrompt(origin: String, callback: GeolocationPermissions.Callback) {
                if (hasLocationPermission()) callback.invoke(origin, true, false)
                else { geoPrompt = origin to callback; askLocation.launch(LOCATION_PERMS) }
            }

            override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = callback
                return try { pickImage.launch("image/*"); true } catch (e: Exception) { fileCallback = null; false }
            }
        }
    }

    /** Store pages stay in the app; phone, WhatsApp, UPI and Google Maps links open their apps. */
    private fun handleUrl(uri: Uri): Boolean {
        val scheme = uri.scheme?.lowercase() ?: return false
        if ((scheme == "http" || scheme == "https") && uri.host == Uri.parse(storeUrl).host) return false
        try {
            val intent = if (scheme == "intent") Intent.parseUri(uri.toString(), Intent.URI_INTENT_SCHEME)
            else Intent(Intent.ACTION_VIEW, uri)
            startActivity(intent)
        } catch (e: ActivityNotFoundException) {
            toast(if (scheme == "upi") "No UPI app found — install GPay, PhonePe or Paytm" else "No app on this phone can open that")
        } catch (e: Exception) {
            toast("Could not open link")
        }
        return true
    }

    private fun showError(msg: String) {
        hideError()
        val box = Ui.column(this, 24).apply {
            gravity = Gravity.CENTER
            setBackgroundColor(Ui.BG)
            addView(Ui.text(this@MainActivity, "📡", 48f).apply { gravity = Gravity.CENTER })
            addView(Ui.title(this@MainActivity, "Can't reach the store").apply { gravity = Gravity.CENTER })
            addView(Ui.text(this@MainActivity, "$storeUrl\n\n$msg\n\nCheck your internet, or that the store server is running.", 14f, Ui.MUTED).apply { gravity = Gravity.CENTER })
            addView(Ui.button(this@MainActivity, "Try again", true) { hideError(); web.loadUrl(startUrl()) })
            if (!Prefs.isFixed()) addView(Ui.button(this@MainActivity, "Change store address") { openSetup() })
            if (BuildConfig.STAFF) addView(Ui.button(this@MainActivity, "GPS & phone test") { startActivity(Intent(this@MainActivity, GpsTestActivity::class.java)) })
        }
        errorView = box
        root.addView(box, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
    }

    private fun hideError() {
        errorView?.let { root.removeView(it) }
        errorView = null
    }

    override fun onResume() {
        super.onResume()
        if (!::web.isInitialized) return
        // store address changed in Setup → load the new one
        val now = Prefs.storeUrl(this)
        if (now != null && (now != storeUrl || startUrl() != loadedStart)) {
            storeUrl = now
            loadedStart = startUrl()
            hideError()
            web.loadUrl(loadedStart)
            web.clearHistory()
        }
        web.evaluateJavascript("window.__skAppResumed && window.__skAppResumed()", null)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        if (::web.isInitialized) web.saveState(outState)
    }

    override fun onDestroy() {
        if (::web.isInitialized) {
            root.removeView(web)
            web.destroy()
        }
        super.onDestroy()
    }

    // ---------- used by AppBridge ----------
    fun hasLocationPermission(): Boolean =
        ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
            ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

    fun withLocationPermission(ok: () -> Unit, denied: () -> Unit = {}) {
        if (hasLocationPermission()) { ok(); return }
        afterLocationOk = ok; afterLocationDenied = denied
        askLocation.launch(LOCATION_PERMS)
    }

    fun js(code: String) = runOnUiThread { if (::web.isInitialized) web.evaluateJavascript(code, null) }

    @SuppressLint("MissingPermission")
    fun oneShotLocation(cb: String) {
        if (!Regex("^[A-Za-z_$][A-Za-z0-9_$]*$").matches(cb)) return
        val fail = { msg: String -> js("window.$cb && window.$cb(null, null, null, ${JSONObject.quote(msg)})") }
        withLocationPermission({
            LocationServices.getFusedLocationProviderClient(this)
                .getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, null)
                .addOnSuccessListener { l ->
                    if (l != null) js("window.$cb && window.$cb(${l.latitude}, ${l.longitude}, ${l.accuracy})")
                    else fail("Could not get a GPS fix — is Location turned on?")
                }
                .addOnFailureListener { e -> fail(e.message ?: "GPS error") }
        }, { fail("Location permission was denied") })
    }

    fun startTracking(json: String) {
        if (!BuildConfig.STAFF) return
        withLocationPermission({
            if (!LocationService.start(this, json, false)) toast(TrackingState.lastResult)
        }, { js("window.__skTrackingDenied && window.__skTrackingDenied()") })
    }

    fun printPage() {
        val pm = getSystemService(Context.PRINT_SERVICE) as PrintManager
        pm.print("StoreKart bill", web.createPrintDocumentAdapter("StoreKart bill"), PrintAttributes.Builder().build())
    }

    fun openSetup() { if (!Prefs.isFixed()) startActivity(Intent(this, SetupActivity::class.java).putExtra("change", true)) }

    fun toast(msg: String) = runOnUiThread { Toast.makeText(this, msg, Toast.LENGTH_LONG).show() }
}

/** window.StoreKartApp — what the store web pages can ask the phone to do. */
class AppBridge(private val act: MainActivity) {
    @JavascriptInterface fun isApp(): Boolean = true
    @JavascriptInterface fun version(): String = BuildConfig.VERSION_NAME
    /** "customer" or "staff" — the web pages show only what fits the app. */
    @JavascriptInterface fun appMode(): String = if (BuildConfig.STAFF) "staff" else "customer"
    /** true when the store address is built in (no "change store" option). */
    @JavascriptInterface fun fixedStore(): Boolean = Prefs.isFixed()

    /** Start/refresh background location sharing for the delivery boy's orders that are out for delivery. */
    @JavascriptInterface fun startTracking(json: String): String {
        if (!BuildConfig.STAFF) return "not-in-customer-app"
        val n = try { JSONObject(json).optJSONArray("orders")?.length() ?: 0 } catch (e: Exception) { return "bad-config" }
        if (n == 0) { stopTracking(); return "stopped" }
        act.runOnUiThread { act.startTracking(json) }
        return if (act.hasLocationPermission()) "ok" else "asking-permission"
    }

    @JavascriptInterface fun stopTracking() { if (BuildConfig.STAFF) act.runOnUiThread { LocationService.stop(act) } }
    @JavascriptInterface fun trackingStatus(): String = TrackingState.toJson()
    @JavascriptInterface fun notify(title: String, body: String) { Notifier.orderAlert(act, title, body) }
    @JavascriptInterface fun getLocation(callbackName: String) { act.runOnUiThread { act.oneShotLocation(callbackName) } }
    @JavascriptInterface fun printPage() { act.runOnUiThread { act.printPage() } }
    @JavascriptInterface fun openGpsTest() { if (BuildConfig.STAFF) act.runOnUiThread { act.startActivity(Intent(act, GpsTestActivity::class.java)) } }
    @JavascriptInterface fun changeStore() { act.runOnUiThread { act.openSetup() } }
}
