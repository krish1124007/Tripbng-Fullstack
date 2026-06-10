const fs = require('fs');

// 1. payment-config.service.ts
let cfgTs = fs.readFileSync('apps/api/src/services/payment/payment-config.service.ts', 'utf8');
cfgTs = cfgTs.replace(
    /providerCode: 'ICICI_EAZYPAY' \| 'ORANGE_PG' \| 'PHONEPE' \| 'RAZORPAY',/g,
    "providerCode: 'ICICI_EAZYPAY' | 'ORANGE_PG' | 'PHONEPE' | 'RAZORPAY' | 'ICICI_ORANGE_PG',"
);
fs.writeFileSync('apps/api/src/services/payment/payment-config.service.ts', cfgTs);

// 2. settlement-csv-parser.service.ts map undefined
let csvTs = fs.readFileSync('apps/api/src/services/payment/settlement-csv-parser.service.ts', 'utf8');
csvTs = csvTs.replace(/Object\.keys\(map\)/g, "Object.keys(map || {})");
csvTs = csvTs.replace(/map\[key as keyof GatewayRow\]/g, "(map || {})[key as keyof GatewayRow]");
fs.writeFileSync('apps/api/src/services/payment/settlement-csv-parser.service.ts', csvTs);

// 3. search.service.ts commissionPctCache and imports
let searchTs = fs.readFileSync('apps/api/src/services/search.service.ts', 'utf8');
if (!searchTs.includes("const commissionPctCache = new Map<string, number>();")) {
    searchTs = searchTs.replace(
        "const bookingDate = new Date();",
        "const bookingDate = new Date();\n  const commissionPctCache = new Map<string, number>();"
    );
}
// check if supplier commission is imported
if (searchTs.includes("from './pricing/supplier-commission.service.js'")) {
    searchTs = searchTs.replace(
        "from './pricing/supplier-commission.service.js'",
        "from './pricing/map-policy-pricing.service.js'"
    );
} else {
    // If it's missing, add it
    if (!searchTs.includes('resolveSupplierCommissionPaise')) {
        searchTs = "import { resolveSupplierCommissionPaise } from './pricing/map-policy-pricing.service.js';\n" + searchTs;
    } else if (!searchTs.includes("from './pricing/map-policy-pricing.service.js'")) {
        // Just replace the whole map-policy import block
        // Actually, we imported it in previous patch!
    }
}
fs.writeFileSync('apps/api/src/services/search.service.ts', searchTs);

console.log('Done!');
