# StoreKart

A self-hosted online store for **any kind of shop**. When you open it for the first time, a setup wizard asks what kind of business it is and sets everything up to match:

| Business type | What it sets up |
|---|---|
| 🍔 Fast food / Restaurant | Menu with veg/non-veg marks and a "Veg only" filter, sizes (Regular/Large), add-ons (extra cheese), delivery + takeaway + dine-in with table number, packing charge |
| 👕 Clothing / Fashion | Size and colour choices, MRP with "% OFF" badges, free delivery above ₹999, return policy note |
| 🛒 Grocery / Kirana | Pack sizes (500 g / 1 kg / 5 kg), MRP savings, delivery time slots, minimum order |
| 🎂 Bakery / Sweets / Cakes | Cakes by weight, candles and other extras, "message on cake" note, time slots |
| 📱 Mobiles / Electronics | Storage variants, colours, screen guard / cover add-ons, warranty note |
| 🏪 Other / General | A blank store for anything else |

You can change every setting, label and category later. You can also start over with a different business type.

## What customers get
- A store page with search, categories, bestsellers, product photos, and MRP discounts
- A cart, plus checkout with Delivery / Pickup / Dine-in, address, time slot and a note
- Payment by **cash on delivery** or **UPI**. The UPI button opens GPay, PhonePe or Paytm with the amount already filled in, and the money goes straight to your UPI ID.
- An order tracking page that updates by itself
- One tap to send the order to your WhatsApp
- An "Install app" option on Android (it's a PWA)

## Staff logins and roles (at `/#/admin`)
Each person gets their own login name and PIN, and sees only what their job needs:

| Role | What they can do |
|---|---|
| 🛡️ Admin | Everything, including admin accounts and "Start over" |
| 👑 Store owner | Sales figures, staff, settings, products and orders (everything except admin accounts and reset) |
| 🧑‍💼 Manager | Accept or cancel orders, choose the delivery boy, pause orders, manage products |
| 🧾 Cashier / Sales | Pack orders → mark them ready, hand over pickup/dine-in orders, take payment, print bills |
| 🛵 Delivery boy | Sees **only his own** deliveries, can call/WhatsApp the customer, opens Google Maps navigation, shares live location, collects cash and marks the order delivered |

**How an order flows:** customer orders → manager gets a beep and taps **Accept** → manager picks a delivery boy → the cashier gets a beep and **packs** the order → **Packed — ready** → the delivery boy taps **Picked up — start delivery**, which starts sharing his phone's location → **Delivered**, ticking "cash collected" for COD orders.

**What the customer sees:** a timeline plus a full activity log ("Accepted by Rahul (Manager)", "Packed by Suresh", "Out for delivery with Ramesh", "Payment received in cash"…). During delivery they also see the delivery boy's name and a call button, a **live Google Map with the route from him to their door**, how far away he is, and an "Open route in Google Maps" button. At checkout, customers can tap **📍 Use my current location** so the delivery boy navigates straight to them.

Notes:
- Live location needs the store opened over **https** (your Cloudflare domain). The delivery boy's phone shares its location only while the StoreKart page is open on screen. The page keeps the screen awake for this, so he should open Google Maps navigation from the page and come back to mark it delivered.
- Maps work without a Google API key. If Google ever stops the keyless map, add a free "Maps Embed API" key in Settings → Ordering.
- Upgrading from the first version: your old admin password logs in with the login name `admin`.

## What you get in the staff area
- **Orders**: today's orders and sales, a sound and pop-up alert on every new order, one-tap status buttons (Accept → Preparing/Packing → Ready / Out for delivery → Delivered), Mark paid, Cancel (stock goes back), Call/WhatsApp the customer, and print a bill on a 58/80 mm thermal printer
- **Products / Menu**: add or edit items with a photo upload, variants with their own prices, colours, add-ons, stock count, and an in-stock switch
- **Settings**: name, logo, brand colour, opening hours, pause orders, delivery charge, free delivery limit, minimum order, packing charge, time slots, UPI ID, GST (inclusive or added on top, GSTIN on bills), categories, and wording
- **Backup** download, password change, and **Start over / change business type**

Prices are always recalculated on the server, so nobody can change a price in their browser.

## Android app
The `android/` folder is an Android Studio project. It gives delivery boys **live location that keeps working with the screen off**, phone notifications for order alerts, and a **📍 GPS & phone test** screen. GitHub builds the APK automatically: on your phone, open Releases → *StoreKart Android (latest)*. See `android/README.md`.

## Run it on Unraid

**Option A — Docker Compose (Compose Manager plugin)**
1. Copy this folder to the server, e.g. `/mnt/user/appdata/storekart-src`
2. In `docker-compose.yml`, change `./data:/data` to `/mnt/user/appdata/storekart:/data`
3. Compose Up, then open `http://SERVER-IP:3080`

**Option B — Community Apps template**
1. Push this repo to GitHub as `bdlnaredi/storekart`. The included GitHub Action builds the image `ghcr.io/bdlnaredi/storekart:latest` automatically.
2. In GitHub, go to the package settings and make the package **public**.
3. Copy `unraid/storekart.xml` to `/boot/config/plugins/dockerMan/templates-user/my-StoreKart.xml` (or put it in your MediaHub templates). Then go to Docker → Add Container → pick StoreKart.

**Make it public for customers**: add a Cloudflare Tunnel public hostname (e.g. `shop.yourdomain.com`) pointing to `http://SERVER-IP:3080`. HTTPS is needed for the "Install app" option and for order alerts on phones.

## Run without Docker
Needs only Node.js 18 or newer. There's nothing to install:
```
node server.js
```
Then open http://localhost:3080. Your data is saved in `./data` (`db.json` + `uploads/`).

Settings: `PORT` (default 3080) and `DATA_DIR` (default `./data`).
