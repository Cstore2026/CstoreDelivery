// Pure calculations — same tariff for every branch.
export const DEFAULT_CUMULATIVE = [
  { from: 0, to: 5, type: 'base', price: 35 },
  { from: 5, to: 10, type: 'rate', rate: 7 },
  { from: 10, to: null, type: 'rate', rate: 8 }
];

function finiteNonNegative(n) {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0;
}

export function normalizePricing(data = {}) {
  const legacy = [
    { from: 0, to: Number(data.tier1_km ?? 5), type: 'base', price: Number(data.tier1_cost ?? 35) },
    { from: Number(data.tier1_km ?? 5), to: Number(data.tier2_km ?? 10), type: 'rate', rate: Number(data.tier2_rate ?? 7) },
    { from: Number(data.tier2_km ?? 10), to: null, type: 'rate', rate: Number(data.tier3_rate ?? 8) }
  ];
  return {
    activeMode: data.activeMode === 'perKmTier' ? 'perKmTier' : 'cumulative',
    cumulativeTiers: Array.isArray(data.cumulativeTiers) ? structuredClone(data.cumulativeTiers) : legacy,
    perKmTiers: Array.isArray(data.perKmTiers) ? structuredClone(data.perKmTiers) : []
  };
}

export function validatePricing(config) {
  if (!config || !['cumulative', 'perKmTier'].includes(config.activeMode)) return 'نوع التسعير غير صحيح.';
  const a = config.cumulativeTiers;
  const b = config.perKmTiers;
  if (!Array.isArray(a) || a.length < 1) return 'لازم أول شريحة تراكمي تكون موجودة.';
  if (!Array.isArray(b)) return 'شرائح سعر الكيلو غير صحيحة.';
  if (b.length === 0 && config.activeMode === 'perKmTier') return 'لازم تضيف شرائح سعر الكيلو قبل تفعيل النظام.';
  const eq = (x, y) => Math.abs(x - y) < 0.0000001;
  for (let i = 0; i < a.length; i++) {
    const tier = a[i];
    const prev = a[i - 1];
    if (!finiteNonNegative(tier.from) || !eq(tier.from, i ? prev.to : 0)) return 'شرائح التراكمي لازم تبدأ من صفر وتكون متصلة من غير فجوات أو تداخل.';
    if (tier.to !== null && (!finiteNonNegative(tier.to) || tier.to <= tier.from)) return 'نهاية الشريحة التراكمية لازم تكون أكبر من بدايتها.';
    if (tier.to === null && i !== a.length - 1) return 'الشريحة التراكمية المفتوحة لازم تكون الأخيرة.';
    if (i === 0) {
      if (tier.type !== 'base' || tier.to === null || !finiteNonNegative(tier.price)) return 'أول شريحة تراكمي لازم تكون مبلغ ثابت حتى مسافة محددة.';
    } else if (tier.type !== 'rate' || !finiteNonNegative(tier.rate)) return 'باقي شرائح التراكمي لازم يكون لها سعر كيلو صحيح.';
  }
  for (let i = 0; i < b.length; i++) {
    const tier = b[i];
    const prev = b[i - 1];
    if (!finiteNonNegative(tier.from) || !eq(tier.from, i ? prev.to : 0) || !finiteNonNegative(tier.to) || tier.to <= tier.from || !finiteNonNegative(tier.rate)) {
      return 'شرائح سعر الكيلو لازم تكون متصلة، ببداية ونهاية وسعر صالح لكل شريحة.';
    }
  }
  return null;
}

// Ceil the whole road distance BEFORE matching a tier.
export function calculateDeliveryCost(distanceKm, config) {
  if (typeof distanceKm !== 'number' || !Number.isFinite(distanceKm) || distanceKm < 0) return null;
  const km = Math.ceil(distanceKm - 1e-9);
  const roundCurrency = n => Math.round((n + Number.EPSILON) * 100) / 100;
  if (config.activeMode === 'perKmTier') {
    const tier = config.perKmTiers.find(t => km <= t.to && km > t.from || (km === 0 && t.from === 0));
    if (!tier) return { billableKm: km, price: null, outside: true };
    return { billableKm: km, price: roundCurrency(km * tier.rate), outside: false };
  }
  const tiers = config.cumulativeTiers;
  if (!tiers?.length) return null;
  let price = tiers[0].price;
  if (km <= tiers[0].to) return { billableKm: km, price: roundCurrency(price), outside: false };
  for (let i = 1; i < tiers.length; i++) {
    const tier = tiers[i];
    const until = tier.to === null ? km : Math.min(km, tier.to);
    if (until > tier.from) price += (until - tier.from) * tier.rate;
    if (tier.to === null || km <= tier.to) return { billableKm: km, price: roundCurrency(price), outside: false };
  }
  return { billableKm: km, price: null, outside: true };
}
