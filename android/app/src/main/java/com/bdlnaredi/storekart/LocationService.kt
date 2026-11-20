package com.bdlnaredi.storekart

import android.annotation.SuppressLint
import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.location.Location
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import org.json.JSONObject
import java.util.concurrent.Executors

/**
 * Foreground service that shares the delivery boy's GPS with the store server,
 * even when the screen is off or he is using Google Maps navigation.
 *
 * Test mode (from the GPS test screen) only records fixes, it sends nothing.
 */
class LocationService : Service() {

    companion object {
        private const val EXTRA_CONFIG = "config"
        private const val EXTRA_TEST = "test"
        private const val NOTIF_ID = 7
        private const val SEND_EVERY_MS = 8_000L      // when moving
        private const val HEARTBEAT_MS = 30_000L      // even when standing still

        /** config = {"base": "https://shop.example.com/", "token": "...", "orders": [{"id": "..", "number": 1001}]} */
        fun start(ctx: Context, configJson: String?, test: Boolean): Boolean = try {
            val i = Intent(ctx, LocationService::class.java)
                .putExtra(EXTRA_CONFIG, configJson)
                .putExtra(EXTRA_TEST, test)
            ContextCompat.startForegroundService(ctx, i)
            true
        } catch (e: Exception) {
            TrackingState.lastResult = "Could not start: ${e.message}"
            false
        }

        fun stop(ctx: Context) {
            Prefs.setTrackingJson(ctx, null)
            ctx.stopService(Intent(ctx, LocationService::class.java))
        }
    }

    private lateinit var fused: FusedLocationProviderClient
    private val main = Handler(Looper.getMainLooper())
    private val net = Executors.newSingleThreadExecutor()
    private var wake: PowerManager.WakeLock? = null
    private var updatesOn = false

    private var base = ""
    private var token = ""
    private val orders = mutableListOf<Pair<String, Int>>() // order id, order number
    private var lastSentAt = 0L
    private var lastSentLoc: Location? = null

    private val callback = object : LocationCallback() {
        override fun onLocationResult(result: LocationResult) {
            result.lastLocation?.let { onLocation(it) }
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        fused = LocationServices.getFusedLocationProviderClient(this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val test = intent?.getBooleanExtra(EXTRA_TEST, false) ?: false
        // A null intent means Android restarted us — carry on with the saved delivery.
        val cfg = intent?.getStringExtra(EXTRA_CONFIG) ?: if (test) null else Prefs.trackingJson(this)

        if (!updatesOn) TrackingState.reset()
        TrackingState.testMode = test
        if (!test) {
            if (cfg == null || !loadConfig(cfg)) {
                goForeground() // must always be called after startForegroundService
                stopSelf()
                return START_NOT_STICKY
            }
            Prefs.setTrackingJson(this, cfg)
        } else {
            orders.clear(); TrackingState.orders = emptyList()
        }

        if (!goForeground()) { stopSelf(); return START_NOT_STICKY }
        startUpdates()
        return if (test) START_NOT_STICKY else START_STICKY
    }

    private fun loadConfig(json: String): Boolean = try {
        val o = JSONObject(json)
        base = Prefs.normalize(o.getString("base"))
        token = o.getString("token")
        val arr = o.getJSONArray("orders")
        orders.clear()
        for (i in 0 until arr.length()) {
            val item = arr.getJSONObject(i)
            orders.add(item.getString("id") to item.optInt("number", 0))
        }
        TrackingState.orders = orders.map { "#${it.second}" }
        orders.isNotEmpty()
    } catch (e: Exception) {
        TrackingState.lastResult = "Bad tracking data"
        false
    }

    private fun goForeground(): Boolean = try {
        ServiceCompat.startForeground(this, NOTIF_ID, buildNotification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
        true
    } catch (e: Exception) {
        // usually: location permission not granted
        TrackingState.lastResult = "Location permission needed"
        false
    }

    @SuppressLint("MissingPermission")
    private fun startUpdates() {
        if (updatesOn) { refreshNotification(); return }
        val req = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 5_000L)
            .setMinUpdateIntervalMillis(3_000L)
            .setWaitForAccurateLocation(false)
            .build()
        try {
            fused.requestLocationUpdates(req, callback, Looper.getMainLooper())
        } catch (e: SecurityException) {
            TrackingState.lastResult = "Location permission needed"
            stopSelf(); return
        }
        updatesOn = true
        TrackingState.running = true
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        wake = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "StoreKart:delivery").apply {
            setReferenceCounted(false)
            acquire(6 * 60 * 60 * 1000L) // safety limit: 6 hours
        }
    }

    private fun onLocation(l: Location) {
        val now = System.currentTimeMillis()
        val s = TrackingState
        if (s.fixAt > 0) s.maxGapMs = maxOf(s.maxGapMs, now - s.fixAt)
        s.lat = l.latitude; s.lng = l.longitude; s.acc = l.accuracy
        s.speed = if (l.hasSpeed()) l.speed else 0f
        s.fixAt = now; s.fixes++

        if (s.testMode) { if (s.fixes % 3 == 1) refreshNotification(); return }

        val moved = lastSentLoc?.distanceTo(l) ?: Float.MAX_VALUE
        val due = (now - lastSentAt >= SEND_EVERY_MS && moved >= 10f) || now - lastSentAt >= HEARTBEAT_MS
        if (!due) return
        lastSentAt = now; lastSentLoc = l
        val snapshot = orders.toList()
        val body = JSONObject()
            .put("lat", l.latitude).put("lng", l.longitude)
            .put("acc", l.accuracy.toDouble())
            .put("speed", if (l.hasSpeed()) l.speed.toDouble() else JSONObject.NULL)
            .toString()
        net.execute { sendAll(snapshot, body) }
    }

    private fun sendAll(list: List<Pair<String, Int>>, body: String) {
        for ((id, num) in list) {
            val (code, _) = Http.request("${base}api/orders/$id/location", "POST", token, body)
            TrackingState.lastSendAt = System.currentTimeMillis()
            when (code) {
                200, 201 -> { TrackingState.sent++; TrackingState.lastResult = "Sent for #$num" }
                401 -> {
                    TrackingState.lastResult = "Logged out — open the app and log in again"
                    main.post { stopSelf() }
                    return
                }
                403, 404, 409 -> { // delivered, cancelled or reassigned
                    TrackingState.lastResult = "#$num is finished"
                    main.post { removeOrder(id) }
                }
                -1 -> TrackingState.lastResult = "No internet — will keep trying"
                else -> TrackingState.lastResult = "Server error $code"
            }
        }
        main.post { refreshNotification() }
    }

    private fun removeOrder(id: String) {
        orders.removeAll { it.first == id }
        TrackingState.orders = orders.map { "#${it.second}" }
        if (orders.isEmpty()) { Prefs.setTrackingJson(this, null); stopSelf() }
        else {
            val saved = Prefs.trackingJson(this)
            if (saved != null) try {
                val o = JSONObject(saved)
                val arr = org.json.JSONArray()
                orders.forEach { arr.put(JSONObject().put("id", it.first).put("number", it.second)) }
                Prefs.setTrackingJson(this, o.put("orders", arr).toString())
            } catch (_: Exception) { }
            refreshNotification()
        }
    }

    private fun buildNotification(): Notification {
        val s = TrackingState
        val target = if (s.testMode) GpsTestActivity::class.java else MainActivity::class.java
        val open = PendingIntent.getActivity(
            this, 1, Intent(this, target).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        val title = if (s.testMode) "GPS test running" else "Delivering — customer can see you on the map"
        val text = if (s.testMode) "${s.fixes} GPS fixes so far · tap to see results"
        else "Order ${orders.joinToString(", ") { "#${it.second}" }} · ${if (s.lastResult.isEmpty()) "starting GPS…" else s.lastResult}"
        return NotificationCompat.Builder(this, Notifier.CH_TRACK)
            .setSmallIcon(R.drawable.ic_stat_bag)
            .setColor(Ui.BRAND)
            .setContentTitle(title)
            .setContentText(text)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setContentIntent(open)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build()
    }

    @SuppressLint("MissingPermission")
    private fun refreshNotification() {
        if (Notifier.canPost(this)) NotificationManagerCompat.from(this).notify(NOTIF_ID, buildNotification())
    }

    override fun onDestroy() {
        try { fused.removeLocationUpdates(callback) } catch (_: Exception) { }
        updatesOn = false
        TrackingState.running = false
        TrackingState.orders = emptyList()
        try { wake?.release() } catch (_: Exception) { }
        net.shutdown()
        super.onDestroy()
    }
}
