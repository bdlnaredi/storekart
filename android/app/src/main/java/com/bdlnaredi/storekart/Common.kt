package com.bdlnaredi.storekart

import android.Manifest
import android.annotation.SuppressLint
import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

class StoreKartApp : Application() {
    override fun onCreate() {
        super.onCreate()
        Notifier.createChannels(this)
    }
}

/** Saved settings: which store this phone connects to. */
object Prefs {
    private fun sp(ctx: Context) = ctx.getSharedPreferences("storekart", Context.MODE_PRIVATE)

    fun storeUrl(ctx: Context): String? = sp(ctx).getString("url", null)
    fun staffMode(ctx: Context): Boolean = sp(ctx).getBoolean("staff", false)
    fun setStore(ctx: Context, url: String, staff: Boolean) {
        sp(ctx).edit().putString("url", url).putBoolean("staff", staff).apply()
    }

    /** Tracking config kept so the GPS service can carry on if Android restarts it. */
    fun trackingJson(ctx: Context): String? = sp(ctx).getString("tracking", null)
    fun setTrackingJson(ctx: Context, json: String?) {
        sp(ctx).edit().apply { if (json == null) remove("tracking") else putString("tracking", json) }.apply()
    }

    /** "shop.example.com" -> "https://shop.example.com/" */
    fun normalize(input: String): String {
        var u = input.trim()
        if (u.isEmpty()) return u
        if (!u.startsWith("http://") && !u.startsWith("https://")) u = "https://$u"
        u = u.substringBefore("#")
        if (u.endsWith("index.html")) u = u.removeSuffix("index.html")
        if (!u.endsWith("/")) u += "/"
        return u
    }
}

/** Live numbers shared between the GPS service and the screens. */
object TrackingState {
    @Volatile var running = false
    @Volatile var testMode = false
    @Volatile var lat = 0.0
    @Volatile var lng = 0.0
    @Volatile var acc = 0f
    @Volatile var speed = 0f
    @Volatile var fixAt = 0L
    @Volatile var fixes = 0
    @Volatile var sent = 0
    @Volatile var lastSendAt = 0L
    @Volatile var lastResult = ""
    @Volatile var startedAt = 0L
    @Volatile var maxGapMs = 0L
    @Volatile var orders: List<String> = emptyList()

    fun reset() {
        fixes = 0; sent = 0; maxGapMs = 0; fixAt = 0; lastSendAt = 0; lastResult = ""
        startedAt = System.currentTimeMillis()
    }

    fun toJson(): String = JSONObject()
        .put("running", running).put("test", testMode)
        .put("lat", lat).put("lng", lng).put("acc", acc.toDouble()).put("speed", speed.toDouble())
        .put("fixAt", fixAt).put("fixes", fixes).put("sent", sent)
        .put("lastSendAt", lastSendAt).put("lastResult", lastResult)
        .put("orders", JSONArray(orders))
        .toString()
}

object Notifier {
    const val CH_ORDERS = "orders"
    const val CH_TRACK = "tracking"

    fun createChannels(ctx: Context) {
        val nm = ctx.getSystemService(NotificationManager::class.java)
        val orders = NotificationChannel(CH_ORDERS, "Order alerts", NotificationManager.IMPORTANCE_HIGH).apply {
            description = "New orders, orders to pack and new deliveries"
            enableVibration(true)
            vibrationPattern = longArrayOf(0, 300, 150, 300)
        }
        val track = NotificationChannel(CH_TRACK, "Live location sharing", NotificationManager.IMPORTANCE_LOW).apply {
            description = "Shown while your location is shared with a customer"
        }
        nm.createNotificationChannels(listOf(orders, track))
    }

    fun canPost(ctx: Context): Boolean =
        Build.VERSION.SDK_INT < 33 ||
            ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    @SuppressLint("MissingPermission")
    fun orderAlert(ctx: Context, title: String, body: String) {
        if (!canPost(ctx)) return
        val open = PendingIntent.getActivity(
            ctx, 0,
            Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        val n = NotificationCompat.Builder(ctx, CH_ORDERS)
            .setSmallIcon(R.drawable.ic_stat_bag)
            .setColor(Ui.BRAND)
            .setContentTitle(title)
            .setContentText(body)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setDefaults(NotificationCompat.DEFAULT_ALL)
            .setAutoCancel(true)
            .setContentIntent(open)
            .build()
        NotificationManagerCompat.from(ctx).notify((System.currentTimeMillis() % 100000).toInt(), n)
    }
}

/** Tiny HTTP helper (runs on a background thread). Returns status code and body, or -1 on network failure. */
object Http {
    fun request(url: String, method: String = "GET", token: String? = null, body: String? = null): Pair<Int, String> = try {
        val c = URL(url).openConnection() as HttpURLConnection
        c.requestMethod = method
        c.connectTimeout = 10000
        c.readTimeout = 10000
        c.setRequestProperty("Accept", "application/json")
        if (token != null) c.setRequestProperty("Authorization", "Bearer $token")
        if (body != null) {
            c.doOutput = true
            c.setRequestProperty("Content-Type", "application/json")
            c.outputStream.use { it.write(body.toByteArray()) }
        }
        val code = c.responseCode
        val stream = if (code < 400) c.inputStream else c.errorStream
        val text = stream?.bufferedReader()?.use { it.readText() } ?: ""
        c.disconnect()
        code to text
    } catch (e: Exception) {
        -1 to (e.message ?: e.javaClass.simpleName)
    }
}

/** Small helpers to build simple screens in code. */
object Ui {
    val BRAND = Color.parseColor("#E23744")
    val INK = Color.parseColor("#1B1D21")
    val MUTED = Color.parseColor("#6B7079")
    val OK = Color.parseColor("#0F8A3C")
    val BAD = Color.parseColor("#C62828")
    val BG = Color.parseColor("#F6F6F8")

    fun dp(ctx: Context, v: Int): Int = (v * ctx.resources.displayMetrics.density).toInt()

    fun column(ctx: Context, pad: Int = 0): LinearLayout = LinearLayout(ctx).apply {
        orientation = LinearLayout.VERTICAL
        val p = dp(ctx, pad); setPadding(p, p, p, p)
    }

    fun row(ctx: Context): LinearLayout = LinearLayout(ctx).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
    }

    fun text(ctx: Context, s: CharSequence, size: Float = 15f, color: Int = INK, bold: Boolean = false): TextView =
        TextView(ctx).apply {
            text = s; textSize = size; setTextColor(color)
            if (bold) setTypeface(typeface, Typeface.BOLD)
            setLineSpacing(0f, 1.15f)
        }

    fun title(ctx: Context, s: String): TextView = text(ctx, s, 22f, INK, true).apply {
        setPadding(0, dp(ctx, 8), 0, dp(ctx, 4))
    }

    fun rounded(color: Int, radius: Float, stroke: Int? = null, ctx: Context? = null) = GradientDrawable().apply {
        setColor(color); cornerRadius = radius
        if (stroke != null && ctx != null) setStroke(dp(ctx, 1), stroke)
    }

    fun button(ctx: Context, label: String, primary: Boolean = false, onClick: () -> Unit): Button =
        Button(ctx).apply {
            text = label
            isAllCaps = false
            textSize = 15f
            setTextColor(if (primary) Color.WHITE else INK)
            background = rounded(if (primary) BRAND else Color.WHITE, dp(ctx, 10).toFloat(), Color.parseColor("#D9DBE1"), ctx)
            val h = dp(ctx, 14); val v = dp(ctx, 10); setPadding(h, v, h, v)
            stateListAnimator = null
            setOnClickListener { onClick() }
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                topMargin = dp(ctx, 8)
            }
        }

    fun card(ctx: Context, heading: String? = null): LinearLayout = column(ctx, 14).apply {
        background = rounded(Color.WHITE, dp(ctx, 14).toFloat(), Color.parseColor("#E7E8EC"), ctx)
        layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
            topMargin = dp(ctx, 12)
        }
        if (heading != null) addView(text(ctx, heading, 17f, INK, true))
    }

    fun gap(ctx: Context, h: Int): View = View(ctx).apply {
        layoutParams = LinearLayout.LayoutParams(1, dp(ctx, h))
    }
}
