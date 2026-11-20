# StoreKart Android apps

Two apps are built from this one project:

| App | For | Opens |
|---|---|---|
| **Customer app** (`StoreKart-Customer.apk`) | your customers | the shop: menu/products, cart, UPI QR, order tracking with the live delivery map, invoices |
| **Staff app** (`StoreKart-Staff.apk`, dark icon) | owner, manager, cashier, delivery boy | staff login: orders, counter, cash, deliveries with **background live location**, GPS & phone test |

Each app is named after your store (e.g. "Ganesh Kirana" and "Ganesh Kirana Staff"), and both can be on the same phone.

**No one types the store address.** It's built into the apps when GitHub makes them. Because this repository is public, the address is **not** in the code: you keep it in your own GitHub settings (below). Anyone who copies this repo puts in their own. If no address is set, the apps ask for it the first time they open.

**What the apps add to the website:**
- **Staff app only:**
  - Background live location for delivery boys. It keeps sharing with the screen off or while Google Maps navigation is open, and stops by itself when the order is delivered.
  - Order alerts as phone notifications with sound and vibration.
  - The 📍 **GPS & phone test** screen (Staff → 👤). It checks permissions and battery settings, live GPS quality, a screen-off tracking test, the store connection, alerts, and UPI/WhatsApp/Maps apps.
- **Both apps:** "Use my current location" uses the phone's GPS; printing through Android's print screen; phone, WhatsApp, UPI and Google Maps links open their own apps; photos from the gallery.

## One-time setup on GitHub (no coding)
In your repository, go to **Settings → Secrets and variables → Actions**:
1. **Secrets** tab → **New repository secret**: name `STORE_URL`, value your store's address, e.g. `https://shop.yourdomain.com`.
2. **Variables** tab → **New repository variable**: name `STORE_NAME`, value your shop's name (this becomes the app names).
3. **Recommended: your own signing key.** Without it, the apps are signed with the public test key in this repo, so anyone could make a fake "update". To add your own:
   1. In Android Studio go to **Build → Generate Signed App Bundle / APK → APK → Create new…**, save it as `storekart.jks` with alias `storekart`, and remember the password.
   2. In Windows PowerShell, in that folder, run:
      `[Convert]::ToBase64String([IO.File]::ReadAllBytes("storekart.jks")) | Set-Clipboard`
   3. Add secret `STOREKART_KEYSTORE_B64` and paste the copied text.
   4. Add secret `STOREKART_KEYSTORE_PASSWORD` with the password.
   5. Keep `storekart.jks` safe: every future update must be signed with it.
4. Optional:
   - variable `STORE_APP_ID` (e.g. `com.ganeshkirana.shop`), needed only for the Play Store;
   - variable `PUBLISH_APKS` = `false` if you don't want the APKs on the public Releases page.

Then, on GitHub, go to **Actions → Build Android apps → Run workflow**. It also runs by itself whenever the app code changes.

## Get the APKs
On the phone, open your repo's **Releases** page → **Android apps (build …)** and tap **StoreKart-Customer.apk** or **StoreKart-Staff.apk**. Allow "Install unknown apps" for Chrome when asked. (If `PUBLISH_APKS` is `false`: Actions → the latest run → **Artifacts**.)

Share the customer APK with customers (WhatsApp, a QR code at the counter, or the Play Store).

Note: an APK has your store address inside it, so anyone who downloads it from the public Releases page can see that address. That address is your public shop website anyway, so this is usually fine. Set `PUBLISH_APKS=false` if you'd rather not publish the APKs.

Every new build installs over the old one, as long as it is signed with the same key.

## Build on your Windows laptop instead
Open the `android` folder in Android Studio. Add these two lines to `android/local.properties` (this file is never uploaded to GitHub):
```
storekart.url=https://shop.yourdomain.com
storekart.name=Ganesh Kirana
```
Pick **customerDebug** or **staffDebug** in *Build Variants*, plug in the phone (USB debugging on), and press ▶ Run.

## Good to know
- Location sharing starts when the delivery boy taps **Picked up — start delivery**, and stops after **Delivered**.
- For live location outside your home network, use your **https** address (Cloudflare Tunnel). Over `http://` on the LAN, the app's GPS service still works.
- Notifications arrive while the app is open or recently used. Alerts when the app has been fully closed for a long time would need Firebase push; ask if you want that added.
