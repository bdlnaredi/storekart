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

## What you get (Admin, at `/#/admin`)
- **Orders**: today's orders and sales, a sound and pop-up alert on every new order, one-tap status buttons (Accept → Preparing/Packing → Ready / Out for delivery → Delivered), Mark paid, Cancel (stock goes back), Call/WhatsApp the customer, and print a bill on a 58/80 mm thermal printer
- **Products / Menu**: add or edit items with a photo upload, variants with their own prices, colours, add-ons, stock count, and an in-stock switch
- **Settings**: name, logo, brand colour, opening hours, pause orders, delivery charge, free delivery limit, minimum order, packing charge, time slots, UPI ID, GST (inclusive or added on top, GSTIN on bills), categories, and wording
- **Backup** download, password change, and **Start over / change business type**

Prices are always recalculated on the server, so nobody can change a price in their browser.

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
