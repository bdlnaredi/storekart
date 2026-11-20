package com.bdlnaredi.storekart

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.location.GnssStatus
import android.location.Location
import android.location.LocationManager
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.os.VibrationEffect
import android.os.Vibrator
import android.provider.Settings
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Checks everything a delivery boy's (or the shop's) phone needs:
 * permissions, GPS quality, background tracking, store connection, alerts, and UPI/WhatsApp/Maps links.
 */
class GpsTestActivity : AppCompatActivity() {

    private lateinit var fused: FusedLocationProviderClient
    private lateinit var lm: LocationManager
    private val handler = Handler(Looper.getMainLooper())

    private lateinit var permBox: LinearLayout
    private lateinit var gpsText: TextView
    private lateinit var liveBtn: Button
    private lateinit var bgText: TextView
    private lateinit var bgBtn: Button
    private lateinit var serverText: TextView
    private lateinit var appsText: TextView

    private var live = false
    private var liveFixes = 0
    private var liveStartedAt = 0L
    private var lastFix: Location? = null
    private var lastFixAt = 0L
    private var firstFixMs = -1L
    private var satsUsed = 0
    private var satsSeen = 0

    private val askPerms = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { refreshPerms() }

    private val liveCallback = object : LocationCallback() {
        override fun onLocationResult(result: LocationResult) {
            val l = result.lastLocation ?: return
            if (firstFixMs < 0) firstFixMs = System.currentTimeMillis() - liveStartedAt
            lastFix = l; lastFixAt = System.currentTimeMillis(); liveFixes++
        }
    }

    private val gnssCallback = object : GnssStatus.Callback() {
        override fun onSatelliteStatusChanged(status: GnssStatus) {
            satsSeen = status.satelliteCount
            var used = 0
            for (i in 0 until status.satelliteCount) if (status.usedInFix(i)) used++
            satsUsed = used
        }
    }

    private val tick = object : Runnable {
        override fun run() {
            refreshLive(); refreshBackground()
            handler.postDelayed(this, 1000)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        fused = LocationServices.getFusedLocationProviderClient(this)
        lm = getSystemService(Context.LOCATION_SERVICE) as LocationManager

        val col = Ui.column(this, 16)
        col.addView(Ui.title(this, "📍 GPS & phone test"))
        col.addView(Ui.text(this, "${Build.MANUFACTURER} ${Build.MODEL} · Android ${Build.VERSION.RELEASE} · app ${BuildConfig.VERSION_NAME}", 13f, Ui.MUTED))

        // 1. permissions & settings
        permBox = Ui.card(this, "1. Permissions & settings")
        col.addView(permBox)

        // 2. live GPS
        val gpsCard = Ui.card(this, "2. Live GPS")
        gpsText = Ui.text(this, "Tap Start, then walk outside for the best result.", 14f, Ui.MUTED)
        gpsCard.addView(gpsText)
        liveBtn = Ui.button(this, "Start GPS", true) { if (live) stopLive() else startLive() }
        gpsCard.addView(liveBtn)
        gpsCard.addView(Ui.button(this, "Show my spot in Google Maps") {
            val l = lastFix
            if (l == null) toast("Start GPS and wait for a fix first")
            else open("https://www.google.com/maps/search/?api=1&query=${l.latitude},${l.longitude}")
        })
        gpsCard.addView(Ui.button(this, "Test Google Maps navigation") {
            val l = lastFix
            val dest = if (l != null) "${l.latitude + 0.01},${l.longitude + 0.01}" else "India Gate, New Delhi"
            open("https://www.google.com/maps/dir/?api=1&destination=${Uri.encode(dest)}&travelmode=driving&dir_action=navigate")
        })
        col.addView(gpsCard)

        // 3. background tracking
        val bgCard = Ui.card(this, "3. Background tracking test")
        bgCard.addView(Ui.text(this, "Checks that location keeps coming while the screen is off — this is what lets customers follow the delivery boy. Start it, lock the phone for 2–3 minutes (or open Google Maps), then come back.", 14f, Ui.MUTED))
        bgText = Ui.text(this, "", 14f)
        bgCard.addView(bgText)
        bgBtn = Ui.button(this, "Start background test", true) { toggleBackgroundTest() }
        bgCard.addView(bgBtn)
        col.addView(bgCard)

        // 4. store connection
        val srvCard = Ui.card(this, "4. Store connection")
        serverText = Ui.text(this, Prefs.storeUrl(this) ?: "No store address saved yet.", 14f, Ui.MUTED)
        srvCard.addView(serverText)
        srvCard.addView(Ui.button(this, "Test connection") { testServer() })
        srvCard.addView(Ui.button(this, "Change store address") {
            startActivity(Intent(this, SetupActivity::class.java).putExtra("change", true))
        })
        col.addView(srvCard)

        // 5. alerts
        val alertCard = Ui.card(this, "5. Order alerts")
        alertCard.addView(Ui.text(this, "Staff phones get these when a new order comes in, an order needs packing, or a delivery is assigned.", 14f, Ui.MUTED))
        alertCard.addView(Ui.button(this, "Send a test order alert") {
            if (!Notifier.canPost(this)) { toast("Allow notifications first (section 1)"); return@button }
            Notifier.orderAlert(this, "🔔 New order #1234 — ₹499", "This is a test alert from StoreKart")
            toast("Sent — check the notification bar")
        })
        alertCard.addView(Ui.button(this, "Test vibration") { vibrate() })
        alertCard.addView(Ui.button(this, "Test sound") {
            try { RingtoneManager.getRingtone(this, RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION))?.play() } catch (_: Exception) { toast("Could not play sound") }
        })
        col.addView(alertCard)

        // 6. other apps
        val appsCard = Ui.card(this, "6. Calls, WhatsApp & UPI")
        appsText = Ui.text(this, "", 14f)
        appsCard.addView(appsText)
        appsCard.addView(Ui.button(this, "Test phone dialer") { open("tel:") })
        appsCard.addView(Ui.button(this, "Test WhatsApp") { open("https://wa.me/?text=" + Uri.encode("StoreKart test message")) })
        appsCard.addView(Ui.button(this, "Test UPI payment screen (₹1, you can cancel)") {
            open("upi://pay?pa=test@upi&pn=StoreKart%20Test&am=1.00&cu=INR&tn=StoreKart%20test")
        })
        col.addView(appsCard)
        col.addView(Ui.gap(this, 24))

        setContentView(ScrollView(this).apply { setBackgroundColor(Ui.BG); addView(col) })
        refreshApps()
    }

    override fun onResume() {
        super.onResume()
        refreshPerms()
        handler.post(tick)
    }

    override fun onPause() {
        super.onPause()
        handler.removeCallbacks(tick)
        stopLive()
    }

    // ---------- 1. permissions ----------
    private fun granted(p: String) = ContextCompat.checkSelfPermission(this, p) == PackageManager.PERMISSION_GRANTED

    private fun refreshPerms() {
        permBox.removeViews(1, permBox.childCount - 1) // keep the heading
        val fine = granted(Manifest.permission.ACCESS_FINE_LOCATION)
        val coarse = granted(Manifest.permission.ACCESS_COARSE_LOCATION)
        val gpsOn = if (Build.VERSION.SDK_INT >= 28) lm.isLocationEnabled else lm.isProviderEnabled(LocationManager.GPS_PROVIDER)
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        val battery = pm.isIgnoringBatteryOptimizations(packageName)

        checkRow("Location permission", fine || coarse, if (fine) "Precise location allowed" else if (coarse) "Only approximate — allow Precise for delivery tracking" else "Not allowed yet",
            if (!fine) "Allow" else null) { askPerms.launch(MainActivity.LOCATION_PERMS) }
        checkRow("Location (GPS) switched on", gpsOn, if (gpsOn) "On" else "Turn on Location in quick settings", if (!gpsOn) "Open" else null) {
            startActivity(Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS))
        }
        checkRow("Notifications", Notifier.canPost(this), if (Notifier.canPost(this)) "Allowed" else "Needed for order alerts", if (!Notifier.canPost(this)) "Allow" else null) {
            if (Build.VERSION.SDK_INT >= 33) askPerms.launch(arrayOf(Manifest.permission.POST_NOTIFICATIONS)) else openAppSettings()
        }
        checkRow("Battery: run without limits", battery, if (battery) "StoreKart won't be stopped in the background" else "Recommended for delivery boys — some phones (Xiaomi, Vivo, Oppo, Realme) stop GPS otherwise", if (!battery) "Fix" else null) {
            @SuppressLint("BatteryLife")
            val i = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName"))
            try { startActivity(i) } catch (_: Exception) { startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)) }
        }
        permBox.addView(Ui.button(this, "Open StoreKart app settings") { openAppSettings() })
        permBox.addView(Ui.text(this, "On Xiaomi/Redmi also set: App settings → Battery saver → No restrictions, and turn on Autostart.", 12f, Ui.MUTED).apply { setPadding(0, Ui.dp(this@GpsTestActivity, 6), 0, 0) })
    }

    private fun checkRow(label: String, ok: Boolean, detail: String, action: String?, onAction: () -> Unit) {
        val row = Ui.row(this).apply { setPadding(0, Ui.dp(this@GpsTestActivity, 8), 0, 0) }
        val texts = Ui.column(this).apply {
            addView(Ui.text(this@GpsTestActivity, "${if (ok) "✅" else "⚠️"}  $label", 15f, Ui.INK, true))
            addView(Ui.text(this@GpsTestActivity, detail, 13f, if (ok) Ui.MUTED else Ui.BAD))
        }
        row.addView(texts, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        if (action != null) {
            val b = Ui.button(this, action, true, onAction)
            b.layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT)
            row.addView(b)
        }
        permBox.addView(row)
    }

    private fun openAppSettings() = startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName")))

    // ---------- 2. live GPS ----------
    @SuppressLint("MissingPermission")
    private fun startLive() {
        if (!granted(Manifest.permission.ACCESS_FINE_LOCATION) && !granted(Manifest.permission.ACCESS_COARSE_LOCATION)) {
            askPerms.launch(MainActivity.LOCATION_PERMS); return
        }
        val req = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 1000L).setMinUpdateIntervalMillis(500L).build()
        try {
            fused.requestLocationUpdates(req, liveCallback, Looper.getMainLooper())
            if (granted(Manifest.permission.ACCESS_FINE_LOCATION)) lm.registerGnssStatusCallback(gnssCallback, handler)
        } catch (e: SecurityException) { toast("Location permission needed"); return }
        live = true; liveFixes = 0; firstFixMs = -1; liveStartedAt = System.currentTimeMillis(); lastFix = null
        liveBtn.text = "Stop GPS"
    }

    private fun stopLive() {
        if (!live) return
        fused.removeLocationUpdates(liveCallback)
        try { lm.unregisterGnssStatusCallback(gnssCallback) } catch (_: Exception) { }
        live = false
        liveBtn.text = "Start GPS"
    }

    private fun refreshLive() {
        if (!live) return
        val l = lastFix
        if (l == null) {
            val secs = (System.currentTimeMillis() - liveStartedAt) / 1000
            gpsText.text = "Searching for satellites… ${secs}s\nSatellites seen: $satsSeen, used: $satsUsed\n(Indoors this can take a minute — try near a window.)"
            gpsText.setTextColor(Ui.MUTED); return
        }
        val acc = l.accuracy
        val grade = when {
            acc <= 10 -> "Excellent ✅"
            acc <= 25 -> "Good ✅"
            acc <= 60 -> "OK — fine for delivery"
            else -> "Weak ⚠️ — move outdoors"
        }
        val age = (System.currentTimeMillis() - lastFixAt) / 1000
        gpsText.setTextColor(Ui.INK)
        gpsText.text = buildString {
            append("Position: %.6f, %.6f\n".format(Locale.US, l.latitude, l.longitude))
            append("Accuracy: ±${acc.toInt()} m  ($grade)\n")
            append("Speed: ${if (l.hasSpeed()) "%.1f km/h".format(Locale.US, l.speed * 3.6f) else "—"}")
            append("   Direction: ${if (l.hasBearing()) "${l.bearing.toInt()}°" else "—"}\n")
            append("Satellites: $satsUsed used of $satsSeen seen\n")
            append("First fix in ${firstFixMs / 1000.0}s · $liveFixes updates · last ${age}s ago\n")
            append("Source: ${l.provider ?: "fused"}")
        }
    }

    // ---------- 3. background test ----------
    private fun toggleBackgroundTest() {
        val s = TrackingState
        if (s.running && !s.testMode) { toast("A real delivery is being tracked right now — finish it first."); return }
        if (s.running) { LocationService.stop(this); toast("Background test stopped"); return }
        if (!granted(Manifest.permission.ACCESS_FINE_LOCATION) && !granted(Manifest.permission.ACCESS_COARSE_LOCATION)) {
            askPerms.launch(MainActivity.LOCATION_PERMS); return
        }
        if (LocationService.start(this, null, true)) toast("Started — now lock your phone for 2–3 minutes")
        else toast(s.lastResult)
    }

    private fun refreshBackground() {
        val s = TrackingState
        val fmt = SimpleDateFormat("h:mm:ss a", Locale.getDefault())
        if (!s.running) {
            bgBtn.text = "Start background test"
            if (s.fixes > 0 && s.testMode) {
                bgText.text = "Last test: ${s.fixes} fixes in ${(s.fixAt - s.startedAt) / 1000}s · longest gap ${s.maxGapMs / 1000}s\n" + verdict(s.maxGapMs)
            } else bgText.text = ""
            return
        }
        if (!s.testMode) {
            bgBtn.text = "Delivery tracking is running"
            bgText.text = "Sharing with customers for ${s.orders.joinToString(", ")}\n" +
                "Sent ${s.sent} updates · ${if (s.lastResult.isEmpty()) "starting…" else s.lastResult}" +
                (if (s.fixAt > 0) "\nLast GPS fix ${fmt.format(Date(s.fixAt))} (±${s.acc.toInt()} m)" else "")
            return
        }
        bgBtn.text = "Stop background test"
        val runFor = (System.currentTimeMillis() - s.startedAt) / 1000
        bgText.text = "Running ${runFor}s · ${s.fixes} fixes received\n" +
            (if (s.fixAt > 0) "Last fix ${fmt.format(Date(s.fixAt))} · longest gap ${s.maxGapMs / 1000}s\n" else "Waiting for first fix…\n") +
            if (runFor > 60 && s.fixes > 0) verdict(s.maxGapMs) else "Lock the phone now, come back in 2–3 minutes."
    }

    private fun verdict(maxGapMs: Long): String = when {
        maxGapMs <= 20_000 -> "✅ Great — tracking keeps working with the screen off."
        maxGapMs <= 60_000 -> "🟡 OK — small pauses. Set Battery to “no restrictions” for smoother tracking."
        else -> "⚠️ The phone paused GPS for ${maxGapMs / 1000}s. Fix the Battery setting in section 1 and test again."
    }

    // ---------- 4. server ----------
    private fun testServer() {
        val url = Prefs.storeUrl(this)
        if (url == null) { serverText.text = "No store address saved yet."; return }
        serverText.text = "Checking $url …"; serverText.setTextColor(Ui.MUTED)
        Thread {
            val t0 = System.currentTimeMillis()
            val (code, body) = Http.request(url + "api/health")
            val ms = System.currentTimeMillis() - t0
            val (cfgCode, cfgBody) = if (code == 200) Http.request(url + "api/config") else (0 to "")
            runOnUiThread {
                if (code == 200 && body.contains("\"ok\"")) {
                    val cfg = try { JSONObject(cfgBody) } catch (_: Exception) { JSONObject() }
                    val name = cfg.optString("name", "your store")
                    val open = cfg.optBoolean("isOpen", false)
                    serverText.text = "✅ Connected to $name in $ms ms\n${if (open) "Store is open and taking orders" else "Store is closed / paused right now"}" +
                        (if (url.startsWith("http://")) "\n⚠️ This is http:// — fine on home Wi-Fi; use your https:// domain outside." else "")
                    serverText.setTextColor(Ui.OK)
                } else {
                    serverText.text = if (code == -1) "✗ Can't reach $url\n$body" else "✗ $url answered with code $code (cfg $cfgCode) — is this the StoreKart address?"
                    serverText.setTextColor(Ui.BAD)
                }
            }
        }.start()
    }

    // ---------- 5/6. alerts & apps ----------
    @Suppress("DEPRECATION")
    private fun vibrate() {
        val v = getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
        if (!v.hasVibrator()) { toast("This phone has no vibration motor"); return }
        v.vibrate(VibrationEffect.createWaveform(longArrayOf(0, 300, 150, 300), -1))
    }

    private fun refreshApps() {
        val pm = packageManager
        val upi = pm.queryIntentActivities(Intent(Intent.ACTION_VIEW, Uri.parse("upi://pay")), 0)
            .map { it.loadLabel(pm).toString() }.distinct()
        val wa = isInstalled("com.whatsapp") || isInstalled("com.whatsapp.w4b")
        val maps = isInstalled("com.google.android.apps.maps")
        appsText.text = buildString {
            append(if (upi.isNotEmpty()) "✅ UPI apps: ${upi.joinToString(", ")}\n" else "⚠️ No UPI app found (GPay, PhonePe, Paytm)\n")
            append(if (wa) "✅ WhatsApp installed\n" else "⚠️ WhatsApp not installed\n")
            append(if (maps) "✅ Google Maps installed" else "⚠️ Google Maps not installed — needed for navigation")
        }
    }

    private fun isInstalled(pkg: String): Boolean = try { packageManager.getPackageInfo(pkg, 0); true } catch (_: Exception) { false }

    private fun open(url: String) {
        try { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }
        catch (_: Exception) { toast("No app on this phone can open that") }
    }

    private fun toast(msg: String) = Toast.makeText(this, msg, Toast.LENGTH_LONG).show()
}
