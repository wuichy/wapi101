// Crea los productos y precios de Wapi101 en Stripe.
//
// Idempotente: usa lookup_keys para evitar duplicados. Si el price ya existe
// con ese lookup_key, lo reusa.
//
// Uso:
//   STRIPE_SECRET_KEY=sk_test_... node scripts/seed-stripe-products.js
//
// Output: imprime los price_id de cada plan, listos para guardar en .env
// (STRIPE_PRICE_STARTER_MONTHLY, etc).

const Stripe = require('stripe');

const key = process.env.STRIPE_SECRET_KEY;
if (!key) { console.error('Falta STRIPE_SECRET_KEY en env'); process.exit(1); }
const stripe = new Stripe(key, { apiVersion: '2024-12-18.acacia' });

// Definición de planes. Mensual y anual con 20% off (anual = 12 mensualidades * 0.80).
// Precios en USD por ahora. Si se quiere MXN, cambiar currency: 'mxn' y los amounts.
const PLANS = [
  {
    productKey: 'wapi101_starter',
    name: 'Wapi101 Starter',
    description: 'Para emprendedores solos. 1 usuario, 500 contactos, 1 número WhatsApp, plantillas básicas.',
    prices: [
      { lookup_key: 'starter_monthly_usd', interval: 'month',  amount: 2900 },  // $29 USD/mes
      { lookup_key: 'starter_yearly_usd',  interval: 'year',   amount: 27840 }, // $278.40 (29*12*0.80)
    ],
  },
  {
    productKey: 'wapi101_pro',
    name: 'Wapi101 Pro',
    description: 'Para PyMEs 2-10 personas. 5 usuarios, ilimitados contactos, bots con flujos, 3 números WhatsApp.',
    prices: [
      { lookup_key: 'pro_monthly_usd', interval: 'month', amount: 7900 },  // $79
      { lookup_key: 'pro_yearly_usd',  interval: 'year',  amount: 75840 }, // $758.40
    ],
  },
  {
    productKey: 'wapi101_business',
    name: 'Wapi101 Business',
    description: 'Para equipos 20+ personas. Ilimitado, IA auto-respuesta, white-label, soporte prioritario.',
    prices: [
      { lookup_key: 'business_monthly_usd', interval: 'month', amount: 19900 },  // $199
      { lookup_key: 'business_yearly_usd',  interval: 'year',  amount: 191040 }, // $1910.40
    ],
  },
];

async function findOrCreateProduct(plan) {
  // Stripe no permite query directo por nombre — buscamos por list y filter
  const products = await stripe.products.list({ limit: 100 });
  const existing = products.data.find(p => p.metadata?.product_key === plan.productKey);
  if (existing) {
    console.log(`  → producto ya existe: ${existing.id} (${existing.name})`);
    return existing;
  }
  const p = await stripe.products.create({
    name: plan.name,
    description: plan.description,
    metadata: { product_key: plan.productKey },
  });
  console.log(`  → producto creado: ${p.id} (${p.name})`);
  return p;
}

async function findOrCreatePrice(product, priceConfig) {
  // Buscar por lookup_key (Stripe ya garantiza unicidad)
  const prices = await stripe.prices.list({ lookup_keys: [priceConfig.lookup_key], expand: ['data.product'] });
  if (prices.data.length) {
    const existing = prices.data[0];
    console.log(`  → price ya existe: ${existing.id} (${priceConfig.lookup_key})`);
    return existing;
  }
  const price = await stripe.prices.create({
    product: product.id,
    unit_amount: priceConfig.amount,
    currency: 'usd',
    recurring: { interval: priceConfig.interval },
    lookup_key: priceConfig.lookup_key,
  });
  console.log(`  → price creado: ${price.id} (${priceConfig.lookup_key} = ${priceConfig.amount/100} USD/${priceConfig.interval})`);
  return price;
}

(async () => {
  const results = {};
  for (const plan of PLANS) {
    console.log(`\n[${plan.productKey}]`);
    const product = await findOrCreateProduct(plan);
    for (const pc of plan.prices) {
      const price = await findOrCreatePrice(product, pc);
      results[pc.lookup_key] = price.id;
    }
  }
  console.log('\n=== Price IDs ===');
  for (const [k, v] of Object.entries(results)) console.log(`  ${k.padEnd(30)} = ${v}`);
  console.log('\nGuárdalos en el .env del droplet con prefijo STRIPE_PRICE_:');
  console.log('  STRIPE_PRICE_STARTER_MONTHLY=' + results.starter_monthly_usd);
  console.log('  STRIPE_PRICE_STARTER_YEARLY=' + results.starter_yearly_usd);
  console.log('  STRIPE_PRICE_PRO_MONTHLY='     + results.pro_monthly_usd);
  console.log('  STRIPE_PRICE_PRO_YEARLY='      + results.pro_yearly_usd);
  console.log('  STRIPE_PRICE_BUSINESS_MONTHLY='+ results.business_monthly_usd);
  console.log('  STRIPE_PRICE_BUSINESS_YEARLY=' + results.business_yearly_usd);
})().catch(err => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
