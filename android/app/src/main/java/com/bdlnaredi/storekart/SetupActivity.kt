package com.bdlnaredi.storekart

import android.content.Intent
import android.os.Bundle
import android.text.InputType
import android.widget.EditText
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import org.json.JSONObject

/** Only used when no store address was built into the app: asks for it once. */
class SetupActivity : AppCompatActivity() {

    private lateinit var urlBox: EditText
    private lateinit var status: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Prefs.isFixed()) { // the address is built in — nothing to set up
            startActivity(Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_NEW_TASK))
            finish(); return
        }
        val col = Ui.column(this, 20)
        col.setBackgroundColor(Ui.BG)

        col.addView(Ui.text(this, "🛍️", 44f))
        col.addView(Ui.title(this, "Connect to your store"))
        col.addView(Ui.text(this, "Type your StoreKart address — for example shop.yourdomain.com, or http://192.168.1.10:3080 on home Wi-Fi.", 14f, Ui.MUTED))

        urlBox = EditText(this).apply {
            hint = "https://shop.yourdomain.com"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            setSingleLine()
            setText(Prefs.storeUrl(this@SetupActivity) ?: "")
            background = Ui.rounded(android.graphics.Color.WHITE, Ui.dp(this@SetupActivity, 10).toFloat(), android.graphics.Color.parseColor("#D9DBE1"), this@SetupActivity)
            val p = Ui.dp(this@SetupActivity, 12); setPadding(p, p, p, p)
        }
        col.addView(Ui.gap(this, 12))
        col.addView(urlBox)


        status = Ui.text(this, "", 14f, Ui.MUTED)
        col.addView(Ui.gap(this, 8))
        col.addView(status)
        col.addView(Ui.button(this, "Test & continue", true) { testAndSave(false) })
        col.addView(Ui.button(this, "Save without testing") { testAndSave(true) })
        if (BuildConfig.STAFF) col.addView(Ui.button(this, "📍 GPS & phone test") { startActivity(Intent(this, GpsTestActivity::class.java)) })

        setContentView(ScrollView(this).apply { setBackgroundColor(Ui.BG); addView(col) })
    }

    private fun testAndSave(skipTest: Boolean) {
        val url = Prefs.normalize(urlBox.text.toString())
        if (url.isEmpty()) { status.text = "Please type the store address."; status.setTextColor(Ui.BAD); return }
        if (skipTest) { save(url); return }
        status.text = "Checking $url …"; status.setTextColor(Ui.MUTED)
        Thread {
            val (code, body) = Http.request(url + "api/health")
            val (_, cfgBody) = if (code == 200) Http.request(url + "api/config") else (0 to "")
            runOnUiThread {
                val ok = code == 200 && try { JSONObject(body).optBoolean("ok") } catch (e: Exception) { false }
                if (ok) {
                    val name = try { JSONObject(cfgBody).optString("name", "") } catch (e: Exception) { "" }
                    status.text = "✓ Connected${if (name.isNotEmpty()) " to $name" else ""}"
                    status.setTextColor(Ui.OK)
                    save(url)
                } else {
                    status.text = if (code == -1) "✗ Could not reach $url\n$body" else "✗ That address answered, but it isn't a StoreKart server (code $code)."
                    status.setTextColor(Ui.BAD)
                }
            }
        }.start()
    }

    private fun save(url: String) {
        Prefs.setStore(this, url)
        if (intent.getBooleanExtra("change", false)) finish()
        else {
            startActivity(Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_NEW_TASK))
            finish()
        }
    }
}
