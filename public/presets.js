// Business-type presets used by the first-run setup wizard.
// Each preset decides the look, wording, ordering options and sample menu/catalogue.
window.PRESETS = {
  food: {
    label: 'Fast food / Restaurant', emoji: '🍔', color: '#e23744',
    blurb: 'Menu with veg/non-veg marks, portions, add-ons, delivery, takeaway and dine-in.',
    tagline: 'Hot, fresh and fast — order in a few taps',
    modes: ['delivery', 'pickup', 'dinein'],
    labels: { variant: 'Size', option2: '', addons: 'Add extras', product: 'dish', products: 'Menu', pickup: 'Takeaway', cta: 'Add' },
    features: { veg: true, slots: false, mrp: false },
    delivery: { fee: 30, freeAbove: 299, minOrder: 99, eta: '30–40 min' },
    packingCharge: 10,
    categories: ['Burgers', 'Pizza', 'Wraps & Rolls', 'Sides', 'Beverages', 'Desserts'],
    products: [
      { name: 'Classic Veg Burger', category: 'Burgers', price: 89, veg: true, emoji: '🍔', featured: true, description: 'Crispy veg patty, lettuce, onion and house mayo.', addons: [{ name: 'Extra cheese', price: 20 }, { name: 'Jalapeños', price: 15 }] },
      { name: 'Crispy Chicken Burger', category: 'Burgers', price: 139, veg: false, emoji: '🍗', featured: true, description: 'Fried chicken fillet with spicy sauce.', addons: [{ name: 'Extra cheese', price: 20 }, { name: 'Double patty', price: 60 }] },
      { name: 'Margherita Pizza', category: 'Pizza', price: 149, veg: true, emoji: '🍕', description: 'Tomato sauce and mozzarella.', variants: [{ name: 'Regular 7"', price: 149 }, { name: 'Medium 10"', price: 269 }, { name: 'Large 13"', price: 399 }], addons: [{ name: 'Extra cheese', price: 40 }, { name: 'Cheese burst', price: 70 }] },
      { name: 'Paneer Tikka Pizza', category: 'Pizza', price: 199, veg: true, emoji: '🍕', featured: true, variants: [{ name: 'Regular 7"', price: 199 }, { name: 'Medium 10"', price: 349 }, { name: 'Large 13"', price: 499 }], addons: [{ name: 'Extra cheese', price: 40 }] },
      { name: 'Chicken Kathi Roll', category: 'Wraps & Rolls', price: 129, veg: false, emoji: '🌯' },
      { name: 'Peri Peri Fries', category: 'Sides', price: 99, veg: true, emoji: '🍟', variants: [{ name: 'Regular', price: 99 }, { name: 'Large', price: 139 }] },
      { name: 'Cold Coffee', category: 'Beverages', price: 99, veg: true, emoji: '🥤', addons: [{ name: 'Ice cream scoop', price: 30 }] },
      { name: 'Choco Lava Cake', category: 'Desserts', price: 79, veg: true, emoji: '🍫' },
    ],
  },
  clothing: {
    label: 'Clothing / Fashion', emoji: '👕', color: '#6c4ce0',
    blurb: 'Sizes and colours, MRP with discount %, free delivery above a limit.',
    tagline: 'New styles every week',
    modes: ['delivery', 'pickup'],
    labels: { variant: 'Size', option2: 'Colour', addons: '', product: 'product', products: 'Shop', pickup: 'Store pickup', cta: 'Add to bag' },
    features: { veg: false, slots: false, mrp: true },
    delivery: { fee: 49, freeAbove: 999, minOrder: 0, eta: '2–4 days' },
    policy: 'Easy 7-day exchange on unused items with tags.',
    categories: ['Men', 'Women', 'Kids', 'Accessories'],
    products: [
      { name: 'Cotton Crew T-Shirt', category: 'Men', price: 399, mrp: 799, emoji: '👕', featured: true, sizes: ['S', 'M', 'L', 'XL', 'XXL'], options2: ['Black', 'White', 'Navy', 'Olive'] },
      { name: 'Slim Fit Denim Jeans', category: 'Men', price: 1199, mrp: 2199, emoji: '👖', sizes: ['28', '30', '32', '34', '36'], options2: ['Dark blue', 'Light blue', 'Black'] },
      { name: 'Printed Kurti', category: 'Women', price: 649, mrp: 1299, emoji: '👗', featured: true, sizes: ['S', 'M', 'L', 'XL'], options2: ['Blue', 'Maroon', 'Yellow'] },
      { name: 'Floral Summer Dress', category: 'Women', price: 999, mrp: 1799, emoji: '👗', sizes: ['XS', 'S', 'M', 'L'], options2: ['Pink', 'White'] },
      { name: 'Kids Hoodie', category: 'Kids', price: 549, mrp: 899, emoji: '🧥', sizes: ['2–3Y', '4–5Y', '6–7Y', '8–9Y'], options2: ['Red', 'Grey'] },
      { name: 'Canvas Sneakers', category: 'Accessories', price: 899, mrp: 1499, emoji: '👟', featured: true, sizes: ['6', '7', '8', '9', '10'], options2: ['White', 'Black'] },
      { name: 'Leather Belt', category: 'Accessories', price: 349, mrp: 599, emoji: '🪢', sizes: ['32', '34', '36', '38'], options2: ['Brown', 'Black'] },
    ],
  },
  grocery: {
    label: 'Grocery / Kirana', emoji: '🛒', color: '#0c8a3e',
    blurb: 'Pack sizes (500 g / 1 kg), MRP savings, delivery time slots, minimum order.',
    tagline: 'Daily essentials delivered to your door',
    modes: ['delivery', 'pickup'],
    labels: { variant: 'Pack size', option2: '', addons: '', product: 'item', products: 'Shop', pickup: 'Pick up from store', cta: 'Add' },
    features: { veg: false, slots: true, mrp: true },
    slots: ['8 AM – 11 AM', '11 AM – 2 PM', '4 PM – 7 PM', '7 PM – 9 PM'],
    delivery: { fee: 25, freeAbove: 499, minOrder: 199, eta: 'Same day' },
    categories: ['Fruits & Vegetables', 'Dairy & Bakery', 'Atta, Rice & Dal', 'Oil & Masala', 'Snacks', 'Beverages', 'Household'],
    products: [
      { name: 'Onion', category: 'Fruits & Vegetables', price: 35, mrp: 45, emoji: '🧅', variants: [{ name: '1 kg', price: 35 }, { name: '2 kg', price: 68 }, { name: '5 kg', price: 165 }] },
      { name: 'Tomato', category: 'Fruits & Vegetables', price: 30, mrp: 40, emoji: '🍅', variants: [{ name: '500 g', price: 16 }, { name: '1 kg', price: 30 }] },
      { name: 'Banana (Robusta)', category: 'Fruits & Vegetables', price: 55, emoji: '🍌', unit: '1 dozen' },
      { name: 'Toned Milk', category: 'Dairy & Bakery', price: 27, mrp: 28, emoji: '🥛', unit: '500 ml', featured: true },
      { name: 'Brown Bread', category: 'Dairy & Bakery', price: 45, mrp: 50, emoji: '🍞', unit: '400 g' },
      { name: 'Whole Wheat Atta', category: 'Atta, Rice & Dal', price: 245, mrp: 290, emoji: '🌾', featured: true, variants: [{ name: '5 kg', price: 245 }, { name: '10 kg', price: 475 }] },
      { name: 'Basmati Rice', category: 'Atta, Rice & Dal', price: 129, mrp: 160, emoji: '🍚', variants: [{ name: '1 kg', price: 129 }, { name: '5 kg', price: 599 }] },
      { name: 'Toor Dal', category: 'Atta, Rice & Dal', price: 165, mrp: 190, emoji: '🫘', unit: '1 kg' },
      { name: 'Sunflower Oil', category: 'Oil & Masala', price: 155, mrp: 185, emoji: '🫗', featured: true, variants: [{ name: '1 L', price: 155 }, { name: '5 L', price: 749 }] },
      { name: 'Potato Chips', category: 'Snacks', price: 20, emoji: '🥔', unit: '52 g' },
      { name: 'Tea Powder', category: 'Beverages', price: 145, mrp: 160, emoji: '🍵', unit: '250 g' },
      { name: 'Dishwash Liquid', category: 'Household', price: 99, mrp: 115, emoji: '🧴', unit: '500 ml' },
    ],
  },
  bakery: {
    label: 'Bakery / Sweets / Cakes', emoji: '🎂', color: '#c2410c',
    blurb: 'Cakes by weight, add-ons like candles, message on cake, pickup or delivery.',
    tagline: 'Baked fresh every morning',
    modes: ['delivery', 'pickup'],
    labels: { variant: 'Weight', option2: 'Flavour', addons: 'Extras', product: 'item', products: 'Menu', pickup: 'Pickup', cta: 'Add' },
    features: { veg: true, slots: true, mrp: false },
    slots: ['10 AM – 1 PM', '1 PM – 4 PM', '4 PM – 7 PM', '7 PM – 10 PM'],
    delivery: { fee: 40, freeAbove: 799, minOrder: 0, eta: '45–60 min' },
    categories: ['Cakes', 'Pastries', 'Sweets', 'Breads & Buns', 'Cookies'],
    products: [
      { name: 'Black Forest Cake', category: 'Cakes', price: 450, veg: true, emoji: '🎂', featured: true, variants: [{ name: '0.5 kg', price: 450 }, { name: '1 kg', price: 850 }, { name: '2 kg', price: 1650 }], addons: [{ name: 'Candles', price: 20 }, { name: 'Party popper', price: 60 }] },
      { name: 'Red Velvet Cake', category: 'Cakes', price: 550, veg: true, emoji: '🍰', variants: [{ name: '0.5 kg', price: 550 }, { name: '1 kg', price: 1050 }], addons: [{ name: 'Candles', price: 20 }] },
      { name: 'Chocolate Truffle Pastry', category: 'Pastries', price: 90, veg: true, emoji: '🧁' },
      { name: 'Kaju Katli', category: 'Sweets', price: 280, veg: true, emoji: '🍬', featured: true, variants: [{ name: '250 g', price: 280 }, { name: '500 g', price: 550 }, { name: '1 kg', price: 1080 }] },
      { name: 'Pav (6 pcs)', category: 'Breads & Buns', price: 30, veg: true, emoji: '🥖' },
      { name: 'Butter Cookies', category: 'Cookies', price: 120, veg: true, emoji: '🍪', unit: '200 g' },
    ],
  },
  electronics: {
    label: 'Mobiles / Electronics', emoji: '📱', color: '#1d4ed8',
    blurb: 'Variants like storage, colours, MRP with discount, warranty info.',
    tagline: 'Best prices on gadgets, with warranty',
    modes: ['delivery', 'pickup'],
    labels: { variant: 'Variant', option2: 'Colour', addons: 'Protection', product: 'product', products: 'Shop', pickup: 'Store pickup', cta: 'Add to cart' },
    features: { veg: false, slots: false, mrp: true },
    delivery: { fee: 0, freeAbove: 0, minOrder: 0, eta: '1–3 days' },
    policy: 'All products carry brand warranty. Bill provided with every order.',
    categories: ['Mobiles', 'Audio', 'Chargers & Cables', 'Smart Watches'],
    products: [
      { name: 'Smartphone 5G', category: 'Mobiles', price: 14999, mrp: 18999, emoji: '📱', featured: true, variants: [{ name: '6 GB + 128 GB', price: 14999 }, { name: '8 GB + 256 GB', price: 17499 }], options2: ['Midnight Black', 'Ocean Blue'], addons: [{ name: 'Screen guard fitted', price: 199 }, { name: 'Back cover', price: 249 }] },
      { name: 'Wireless Earbuds', category: 'Audio', price: 1299, mrp: 2999, emoji: '🎧', featured: true, options2: ['Black', 'White'] },
      { name: 'Bluetooth Speaker', category: 'Audio', price: 1799, mrp: 2499, emoji: '🔊' },
      { name: '33W Fast Charger', category: 'Chargers & Cables', price: 699, mrp: 999, emoji: '🔌' },
      { name: 'Type-C Cable 1 m', category: 'Chargers & Cables', price: 199, mrp: 399, emoji: '🔗' },
      { name: 'Smart Watch', category: 'Smart Watches', price: 1999, mrp: 4999, emoji: '⌚', options2: ['Black', 'Silver', 'Pink'] },
    ],
  },
  general: {
    label: 'Other / General store', emoji: '🏪', color: '#0f766e',
    blurb: 'Start blank and add your own categories and products — works for any shop.',
    tagline: 'Order online, quick and easy',
    modes: ['delivery', 'pickup'],
    labels: { variant: 'Option', option2: '', addons: 'Extras', product: 'product', products: 'Shop', pickup: 'Pickup', cta: 'Add' },
    features: { veg: false, slots: false, mrp: true },
    delivery: { fee: 30, freeAbove: 500, minOrder: 0, eta: 'Same day' },
    categories: ['Featured', 'Popular'],
    products: [
      { name: 'Sample product', category: 'Featured', price: 199, mrp: 249, emoji: '📦', description: 'Edit or delete this from the admin panel.' },
    ],
  },
};

// Turn a preset's sample items into product records the server understands.
window.presetProducts = function (key) {
  const pr = window.PRESETS[key];
  return pr.products.map((p, i) => {
    const out = Object.assign({ inStock: true, sort: i }, p);
    if (p.sizes) { out.variants = p.sizes.map(s => ({ name: s, price: p.price })); delete out.sizes; }
    return out;
  });
};

window.presetConfig = function (key) {
  const pr = window.PRESETS[key];
  return {
    businessType: key,
    color: pr.color,
    tagline: pr.tagline,
    logoEmoji: pr.emoji,
    modes: pr.modes.slice(),
    labels: Object.assign({}, pr.labels),
    features: Object.assign({}, pr.features),
    delivery: Object.assign({}, pr.delivery),
    slots: (pr.slots || []).slice(),
    packingCharge: pr.packingCharge || 0,
    policy: pr.policy || '',
    categories: pr.categories.slice(),
    payments: ['cod'],
    upiId: '',
    tax: { enabled: false, rate: 5, inclusive: true, gstin: '' },
    hours: { enabled: false, open: '09:00', close: '22:00' },
    acceptingOrders: true,
    currency: '₹',
    timezone: 'Asia/Kolkata',
  };
};
