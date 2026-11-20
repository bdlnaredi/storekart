# StoreKart Android app

An Android app for StoreKart. It opens your store, either the customer shop or the staff screens, and adds the phone features a website can't do:

- **Background live location for delivery boys.** It keeps sharing even with the screen off or while Google Maps navigation is open. A notification says "Delivering — customer can see you on the map". It stops by itself when the order is delivered.
- **Order alerts as phone notifications** with sound and vibration: new order (owner/manager), order to pack (cashier), new delivery (delivery boy).
- **Customer "Use my current location"** uses the phone's GPS. This also works over `http://` on home Wi-Fi.
- **Bill printing** through Android's print screen (works with Bluetooth/thermal printer apps that add a print service).
- Phone, WhatsApp, UPI (GPay/PhonePe/Paytm) and Google Maps links open their own apps.
- Product photos from the gallery or camera.
- **📍 GPS & phone test screen.** Open it from the app (Staff → 👤 → GPS & phone test), or long-press the app icon. It checks:
  1. Location / notification / battery permissions, with one-tap fixes
  2. Live GPS: position, accuracy, speed, satellites, time to first fix
  3. **Background tracking test**: lock the phone for 2–3 minutes, come back and it tells you whether GPS kept working (important on Xiaomi, Vivo, Oppo and Realme)
  4. Connection to your store server
  5. Test order alert, vibration and sound
  6. Which UPI apps, WhatsApp and Google Maps are installed

## Get the APK (no coding)
1. Push the repo to GitHub. The **Build Android app** action builds the APK automatically. The first build takes about 5 minutes.
2. On your phone, open `https://github.com/bdlnaredi/storekart/releases`, then open **StoreKart Android (latest)** and tap **StoreKart.apk**.
3. Allow "Install unknown apps" for Chrome when Android asks, then install.
4. Open the app, type your store address (e.g. `shop.yourdomain.com`), and choose **Customer** or **Staff**.

Every new build installs over the old one, because all builds use the same signing key.
(`app/storekart-test.jks` is a **test** key. Create your own private key before putting the app on the Play Store.)

## Build on your Windows laptop instead
Open the `android` folder in Android Studio, wait for Gradle sync, plug in the phone (USB debugging on), and press ▶ Run.

## Good to know
- Location sharing starts when the delivery boy taps **Picked up — start delivery**, and stops after **Delivered**.
- For live location outside your home network, use your **https** address (Cloudflare Tunnel). Over `http://` on the LAN, the app's GPS service still works.
- Notifications arrive while the app is open or recently used. Alerts when the app has been fully closed for a long time would need Firebase push; ask if you want that added.
