/**
 * Mock Instamart responses, shaped like the real MCP tool results.
 * Used automatically whenever the user hasn't connected their Swiggy account
 * (or their 5-day token has expired), so the app is always demoable.
 */

const CATALOG = {
  onion: { sku_id: 'SKU_ONION_1KG', name: 'Onion', brand: 'Fresho', quantity: '1 kg', price: 29 },
  onions: { sku_id: 'SKU_ONION_1KG', name: 'Onion', brand: 'Fresho', quantity: '1 kg', price: 29 },
  tomato: { sku_id: 'SKU_TOMATO_500G', name: 'Tomato', brand: 'Fresho', quantity: '500 g', price: 24 },
  tomatoes: { sku_id: 'SKU_TOMATO_500G', name: 'Tomato', brand: 'Fresho', quantity: '500 g', price: 24 },
  curd: { sku_id: 'SKU_CURD_AMUL_400G', name: 'Curd', brand: 'Amul', quantity: '400 g', price: 45 },
  milk: { sku_id: 'SKU_MILK_1L', name: 'Toned Milk', brand: 'Amul', quantity: '1 L', price: 68 },
  butter: { sku_id: 'SKU_BUTTER_AMUL_100G', name: 'Butter', brand: 'Amul', quantity: '100 g', price: 55 },
  eggs: { sku_id: 'SKU_EGGS_DOZEN', name: 'Eggs', brand: 'Fresho', quantity: '1 dozen', price: 89 },
  ghee: { sku_id: 'SKU_GHEE_AMUL_500G', name: 'Ghee', brand: 'Amul', quantity: '500 g', price: 285 },
  atta: { sku_id: 'SKU_ATTA_5KG', name: 'Whole Wheat Atta', brand: 'Aashirvaad', quantity: '5 kg', price: 245 },
  maida: { sku_id: 'SKU_MAIDA_1KG', name: 'Maida', brand: 'Fortune', quantity: '1 kg', price: 52 },
  potato: { sku_id: 'SKU_POTATO_1KG', name: 'Potato', brand: 'Fresho', quantity: '1 kg', price: 32 },
};

const fallback = (query) => ({
  sku_id: `SKU_${query.toUpperCase().replace(/\s+/g, '_').slice(0, 24)}`,
  name: query,
  brand: '',
  quantity: '1 unit',
  price: 40,
});

const lookup = (q) => {
  const key = (q || '').toLowerCase().trim();
  if (CATALOG[key]) return CATALOG[key];
  const partial = Object.keys(CATALOG).find((k) => key.includes(k));
  return partial ? CATALOG[partial] : null;
};

export const mockInstamart = {
  async getAddresses() {
    return {
      addresses: [
        {
          addressId: 'addr_demo_1',
          label: 'Home',
          fullAddress: '14B, Koramangala 5th Block, Bengaluru 560095',
          isDefault: true,
        },
      ],
    };
  },

  async yourGoToItems(itemName) {
    return { preferred: lookup(itemName) };
  },

  async searchProducts(query) {
    return { results: [lookup(query) || fallback(query)] };
  },

  async updateCart(items) {
    return { cart: { items, itemCount: items.length } };
  },

  async getCart(items) {
    const subtotal = items.reduce(
      (sum, i) => sum + (i.price || 40) * (i.quantity_count || 1),
      0
    );
    return { cart: { items, subtotal, deliveryFee: 0, total: subtotal } };
  },

  async checkout() {
    return {
      order: {
        orderId: `SW-${Math.floor(40000 + Math.random() * 9000)}`,
        status: 'placed',
        estimatedDeliveryMinutes: 18,
      },
    };
  },

  async trackOrder() {
    const stages = ['placed', 'preparing', 'out_for_delivery'];
    const idx = Math.floor(Math.random() * stages.length);
    return {
      status: stages[idx],
      rider: { name: 'Arjun K.', distanceKm: (2.4 - idx * 0.6).toFixed(1) },
      etaMinutes: 16 - idx * 4,
    };
  },
};
