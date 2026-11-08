// Generates data/orders.json: a synthetic Shopify-style order book that matches data/emails.json.
// All people, addresses and orders are fictional. Run: npm run seed:orders
import { writeFileSync } from "node:fs";

const TODAY = new Date("2026-11-03T09:00:00Z");
const day = (n: number) => new Date(TODAY.getTime() - n * 86_400_000).toISOString().slice(0, 10);

const CATALOG = {
  "KP-KTL-GN": ["Gooseneck Kettle (stovetop)", 129],
  "KP-KTL-EL": ["Electric Gooseneck Kettle", 159],
  "KP-GRD-PRO": ["Burr Grinder Pro", 189],
  "KP-GRD-HND": ["Hand Grinder", 79],
  "KP-SCL-01": ["Digital Coffee Scale", 49],
  "KP-FLT-100": ["Paper Filters (100)", 8],
  "KP-MUG-W": ["Stoneware Mug Set, White (2)", 42],
  "KP-MUG-B": ["Stoneware Mug Set, Black (2)", 42],
  "KP-CRF-6": ["Glass Carafe 600 ml", 36],
  "KP-DRP-02": ["Ceramic Dripper", 32],
  "KP-BN-ETH": ["Ethiopia Guji Beans 250 g", 19],
  "KP-BN-COL": ["Colombia Huila Beans 250 g", 18],
  "KP-SUB-M": ["Monthly Beans Subscription", 34],
} as const;
type Sku = keyof typeof CATALOG;

type Event = { date: string; status: string; location?: string };
type Spec = {
  id: string;
  name: string;
  email: string;
  placed: number; // days ago
  status: "processing" | "shipped" | "delivered" | "returned" | "returned_to_sender";
  items: [Sku, number][];
  method?: "standard" | "express" | "canada";
  carrier?: string;
  events?: Event[];
  charges?: { amount?: number; currency?: string; status?: string; daysAgo?: number }[];
  payment?: string;
  promo?: string;
  extra?: Record<string, unknown>;
};

const delivered = (shipped: number, arrived: number, carrier = "USPS"): Pick<Spec, "carrier" | "events"> => ({
  carrier,
  events: [
    { date: day(shipped), status: "Shipped", location: "Portland, OR" },
    { date: day(arrived), status: "Delivered" },
  ],
});

const specs: Spec[] = [
  { id: "4801", name: "Priya Nair", email: "priya.nair@example.com", placed: 30, status: "delivered", items: [["KP-GRD-PRO", 1]], ...delivered(29, 24) },
  { id: "4802", name: "Tom Becker", email: "tom.becker@example.net", placed: 14, status: "delivered", items: [["KP-KTL-GN", 1], ["KP-FLT-100", 1]], ...delivered(13, 9) },
  { id: "4803", name: "Aisha Bello", email: "aisha.bello@example.org", placed: 8, status: "delivered", items: [["KP-SCL-01", 1], ["KP-FLT-100", 2]], method: "standard", ...delivered(7, 2) },
  { id: "4804", name: "Lena Fischer", email: "lena.fischer@example.com", placed: 20, status: "delivered", items: [["KP-BN-ETH", 2]], ...delivered(19, 15) },
  {
    id: "4805", name: "Jordan Reyes", email: "jordan.reyes@example.com", placed: 9, status: "shipped", items: [["KP-KTL-EL", 1]], carrier: "USPS",
    events: [
      { date: day(8), status: "Shipped", location: "Portland, OR" },
      { date: day(7), status: "In transit", location: "Reno, NV" },
    ],
  },
  { id: "4806", name: "Hannah Ito", email: "hannah.ito@example.net", placed: 16, status: "delivered", items: [["KP-MUG-W", 1]], ...delivered(15, 12) },
  {
    id: "4807", name: "Marco Silva", email: "marco.silva@example.com", placed: 40, status: "returned", items: [["KP-GRD-HND", 1]], ...delivered(39, 35),
    extra: { return: { requested: day(30), received: day(14), refund_status: "pending", refund_amount: 79 } },
  },
  { id: "4808", name: "Wei Zhang", email: "wei.zhang@example.org", placed: 11, status: "delivered", items: [["KP-DRP-02", 1], ["KP-FLT-100", 1]], ...delivered(10, 6) },
  { id: "4809", name: "Elena Petrova", email: "elena.petrova@example.com", placed: 6, status: "delivered", items: [["KP-GRD-PRO", 1]], ...delivered(5, 1, "UPS") },
  { id: "4810", name: "Derek Owens", email: "derek.owens@example.net", placed: 10, status: "delivered", items: [["KP-CRF-6", 1], ["KP-DRP-02", 1]], ...delivered(9, 5) },
  {
    id: "4811", name: "Gloria Martinez", email: "gloria.martinez@example.com", placed: 16, status: "shipped", items: [["KP-KTL-GN", 1], ["KP-SCL-01", 1]], carrier: "USPS",
    events: [
      { date: day(14), status: "Shipped", location: "Portland, OR" },
      { date: day(12), status: "In transit", location: "Denver, CO" },
    ],
    extra: { previous_contacts: 2 },
  },
  {
    id: "4812", name: "Ben Carter", email: "ben.carter@example.org", placed: 3, status: "shipped", items: [["KP-GRD-HND", 1], ["KP-BN-COL", 1]], carrier: "USPS",
    events: [{ date: day(2), status: "Shipped", location: "Portland, OR" }],
    charges: [{ daysAgo: 3 }, { daysAgo: 3 }],
  },
  {
    id: "4813", name: "Kim Nguyen", email: "kim.nguyen@example.com", placed: 9, status: "delivered", items: [["KP-DRP-02", 1], ["KP-FLT-100", 1], ["KP-BN-ETH", 1]], ...delivered(8, 4),
    extra: { packed_weight_note: "Package weight at delivery 0.9 lb, expected 1.3 lb" },
  },
  {
    id: "4814", name: "Olivia Brooks", email: "olivia.brooks@example.net", placed: 7, status: "shipped", items: [["KP-KTL-EL", 1], ["KP-MUG-W", 1]],
    extra: {
      parcels: [
        { items: ["KP-MUG-W"], carrier: "USPS", tracking: "9400111202555842761031", status: "Delivered", date: day(2) },
        { items: ["KP-KTL-EL"], carrier: "USPS", tracking: "9400111202555842761048", status: "In transit, expected " + day(-2), date: day(1) },
      ],
    },
  },
  { id: "4815", name: "Lukas Wagner", email: "lukas@wagnerstudio.example", placed: 12, status: "delivered", items: [["KP-GRD-PRO", 2], ["KP-SCL-01", 2]], ...delivered(11, 7), extra: { company: "Wagner Studio LLC" } },
  {
    id: "4816", name: "Sophie Laurent", email: "sophie.laurent@example.com", placed: 5, status: "shipped", items: [["KP-KTL-GN", 1]], carrier: "UPS",
    events: [
      { date: day(4), status: "Shipped", location: "Portland, OR" },
      { date: day(1), status: "In transit", location: "Columbus, OH" },
    ],
  },
  {
    id: "4817", name: "Ryan Murphy", email: "ryan.murphy@example.org", placed: 15, status: "returned_to_sender", items: [["KP-CRF-6", 2]], carrier: "USPS",
    events: [
      { date: day(14), status: "Shipped", location: "Portland, OR" },
      { date: day(9), status: "Delivery attempted: address not found" },
      { date: day(3), status: "Returned to sender", location: "Portland, OR" },
    ],
  },
  { id: "4818", name: "Chloe Adams", email: "chloe.adams@example.com", placed: 8, status: "delivered", items: [["KP-MUG-W", 2]], ...delivered(7, 3), extra: { fulfilment_note: "Picked SKU KP-MUG-B x2 (scan mismatch flagged)" } },
  { id: "4819", name: "David Kim", email: "david.kim@example.net", placed: 25, status: "delivered", items: [["KP-SCL-01", 1]], ...delivered(24, 20) },
  { id: "4820", name: "Fatima Zahra", email: "fatima.zahra@example.com", placed: 4, status: "processing", items: [["KP-GRD-PRO", 1], ["KP-BN-ETH", 2]], extra: { hold_reason: "Burr Grinder Pro back-ordered, restock " + day(-3) } },
  { id: "4821", name: "Maya Chen", email: "maya.chen@example.com", placed: 10, status: "delivered", items: [["KP-KTL-GN", 1]], ...delivered(9, 6) },
  { id: "4822", name: "Carlos Romero", email: "carlos.romero@example.es", placed: 14, status: "delivered", items: [["KP-GRD-HND", 1]], ...delivered(13, 10) },
  { id: "4823", name: "Grace Liu", email: "grace.liu@example.org", placed: 12, status: "delivered", items: [["KP-SCL-01", 1]], ...delivered(11, 8) },
  { id: "4824", name: "Noah Patel", email: "noah.patel@example.com", placed: 2, status: "processing", items: [["KP-KTL-EL", 1]] },
  { id: "4825", name: "Emma Rossi", email: "emma.rossi@example.it", placed: 6, status: "delivered", items: [["KP-DRP-02", 1], ["KP-BN-COL", 2]], ...delivered(5, 1), extra: { card_country: "IT" } },
  {
    id: "4826", name: "Julien Moreau", email: "julien.moreau@example.ca", placed: 12, status: "shipped", items: [["KP-KTL-GN", 1]], method: "canada", carrier: "USPS / Canada Post",
    events: [
      { date: day(11), status: "Shipped", location: "Portland, OR" },
      { date: day(6), status: "Customs cleared", location: "Vancouver, BC" },
      { date: day(2), status: "In transit", location: "Montréal, QC" },
    ],
  },
  {
    id: "4827", name: "Isabel Torres", email: "isabel.torres@example.com", placed: 6, status: "shipped", items: [["KP-SCL-01", 1]], method: "express", carrier: "USPS",
    events: [{ date: day(5), status: "Shipped (USPS Ground Advantage)", location: "Portland, OR" }],
    extra: { fulfilment_note: "Shipped with standard USPS label in error; express was paid" },
  },
  { id: "4828", name: "Sean O'Brien", email: "sean.obrien@example.net", placed: 7, status: "delivered", items: [["KP-KTL-GN", 1]], ...delivered(6, 3), extra: { current_price: { "KP-KTL-GN": 109 } } },
  { id: "4829", name: "Ava Thompson", email: "ava.thompson@example.com", placed: 0, status: "processing", items: [["KP-MUG-B", 1], ["KP-BN-ETH", 1]], extra: { confirmation_email: "bounced (mailbox full)" } },
  { id: "4830", name: "Ethan Wright", email: "ethan.wright@example.org", placed: 1, status: "processing", items: [["KP-GRD-HND", 1], ["KP-SCL-01", 1]] },
  { id: "4831", name: "Mia Johnson", email: "mia.johnson@example.com", placed: 1, status: "processing", items: [["KP-CRF-6", 1]] },
  { id: "4832", name: "Liam Scott", email: "liam.scott@example.net", placed: 3, status: "shipped", items: [["KP-SCL-01", 1], ["KP-DRP-02", 1]], method: "express", carrier: "UPS", events: [{ date: day(2), status: "Shipped", location: "Portland, OR" }, { date: day(1), status: "Delivered" }] },
  {
    id: "4833", name: "Zoe Campbell", email: "zoe.campbell@example.com", placed: 2, status: "processing", items: [["KP-SUB-M", 1]],
    extra: { subscription: { status: "cancelled", cancelled_at: "2026-10-29", next_billing_date: "2026-11-01", note: "Renewal charged on 2026-11-01 after cancellation (sync delay)" } },
  },
  { id: "4834", name: "Henry Clark", email: "henry.clark@example.org", placed: 1, status: "processing", items: [["KP-KTL-EL", 1]], extra: { shipping_address_city: "Portland, OR" } },
  {
    id: "4835", name: "Nora Ahmed", email: "nora.ahmed@example.com", placed: 5, status: "shipped", items: [["KP-GRD-PRO", 1]], carrier: "UPS",
    events: [{ date: day(4), status: "Label created, not yet received by carrier" }],
  },
  { id: "4836", name: "Jack Wilson", email: "jack.wilson@example.net", placed: 9, status: "delivered", items: [["KP-BN-COL", 3]], ...delivered(8, 5), extra: { checkout: "guest" } },
];

// Format matches the carrier: UPS "1Z" + 16 chars, USPS 22 digits starting 9400.
const trackingNumber = (carrier: string, id: string) => {
  const digits = String(Number(id) * 7919 * 104729).padStart(12, "0");
  return carrier.startsWith("UPS") ? `1ZKP${id}${digits.slice(-10)}`.slice(0, 18) : `940011120${id}${digits}`.slice(0, 22);
};

const orders = specs.map((s) => {
  const items = s.items.map(([sku, qty]) => ({ sku, name: CATALOG[sku][0], qty, unit_price: CATALOG[sku][1] }));
  const subtotal = items.reduce((sum, i) => sum + i.qty * i.unit_price, 0);
  const method = s.method ?? "standard";
  const fee = method === "express" ? 12.9 : method === "canada" ? 19 : subtotal >= 75 ? 0 : 6.9;
  const discount = 0;
  const total = Math.round((subtotal + fee - discount) * 100) / 100;
  const charges = (s.charges ?? [{}]).map((c, i) => ({
    id: `ch_${s.id}_${i + 1}`,
    amount: c.amount ?? total,
    currency: c.currency ?? "USD",
    status: c.status ?? "captured",
    date: day(c.daysAgo ?? s.placed),
  }));
  return {
    id: s.id,
    customer: { name: s.name, email: s.email },
    placed_at: day(s.placed),
    status: s.status,
    items,
    subtotal,
    shipping: {
      method,
      fee,
      carrier: s.carrier ?? null,
      tracking: s.carrier ? trackingNumber(s.carrier, s.id) : null,
      events: s.events ?? [],
    },
    total,
    payment: { method: s.payment ?? "Visa •••• " + String(Number(s.id) * 37).slice(-4), charges },
    ...(s.extra ?? {}),
  };
});

writeFileSync(new URL("../data/orders.json", import.meta.url), JSON.stringify(orders, null, 2) + "\n");
console.log(`Wrote ${orders.length} orders to data/orders.json`);
