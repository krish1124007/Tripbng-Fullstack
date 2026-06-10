const fs = require('fs');

// 1. Fix search.service.ts imports
let searchTs = fs.readFileSync('apps/api/src/services/search.service.ts', 'utf8');
if (!searchTs.includes("from './search/map-source-filter.service.js'")) {
    searchTs = `import { applyMapSourceFilter } from './search/map-source-filter.service.js';
import { resolveMapPolicy, applyMapPolicyToBreakdown, logMapPolicyApplied } from './pricing/map-policy-pricing.service.js';
import { resolveSupplierCommissionPaise } from './pricing/supplier-commission.service.js';
import { deriveTravelType } from '../data/airports.js';\n` + searchTs;
    fs.writeFileSync('apps/api/src/services/search.service.ts', searchTs);
}

// 2. Fix reports.service.ts imports
let reportsTs = fs.readFileSync('apps/api/src/services/reports.service.ts', 'utf8');
if (!reportsTs.includes("from './wallet/balance-reader.js'")) {
    reportsTs = "import { readAgencyBalances } from './wallet/balance-reader.js';\n" + reportsTs;
    fs.writeFileSync('apps/api/src/services/reports.service.ts', reportsTs);
}

// 3. Fix payment.service.ts providerCode
let paymentTs = fs.readFileSync('apps/api/src/services/payment/payment.service.ts', 'utf8');
paymentTs = paymentTs.replace(
    /providerCode: 'ICICI_EAZYPAY' \| 'ORANGE_PG' \| 'PHONEPE' \| 'RAZORPAY';/g,
    "providerCode: 'ICICI_EAZYPAY' | 'ORANGE_PG' | 'PHONEPE' | 'RAZORPAY' | 'ICICI_ORANGE_PG';"
);
fs.writeFileSync('apps/api/src/services/payment/payment.service.ts', paymentTs);

// 4. Fix payments.routes.ts
let routesTs = fs.readFileSync('apps/api/src/routes/payments.routes.ts', 'utf8');
routesTs = routesTs.replace(
    /'ICICI_EAZYPAY', 'ORANGE_PG', 'PHONEPE', 'RAZORPAY'/g,
    "'ICICI_EAZYPAY', 'ORANGE_PG', 'PHONEPE', 'RAZORPAY', 'ICICI_ORANGE_PG'"
);
fs.writeFileSync('apps/api/src/routes/payments.routes.ts', routesTs);

// 5. Fix settlement-csv-parser.service.ts
let csvTs = fs.readFileSync('apps/api/src/services/payment/settlement-csv-parser.service.ts', 'utf8');
csvTs = csvTs.replace(
    /Record<PaymentProviderCode, Record<keyof GatewayRow, string\[\]>>/g,
    "Partial<Record<PaymentProviderCode, Record<keyof GatewayRow, string[]>>>"
);
fs.writeFileSync('apps/api/src/services/payment/settlement-csv-parser.service.ts', csvTs);

// 6. Fix registry.ts (env === 'PROD' -> _envName === 'PROD')
let regTs = fs.readFileSync('apps/api/src/adapters/payment/registry.ts', 'utf8');
regTs = regTs.replace(/env === 'PROD'/g, "_envName === 'PROD'");
// And fix registry.ts (72,55): Type '"ICICI_ORANGE_PG"' is not assignable to type '"ICICI_EAZYPAY" | "ORANGE_PG" | "PHONEPE" | "RAZORPAY"'.
// The error is in `getProvider` line 72: `providerCode: pt.providerCode as PaymentProviderCode`. Wait, we already added ICICI_ORANGE_PG to PaymentProviderCode. 
// Ah! Wait, the error is `src/adapters/payment/registry.ts(72,55)`... Wait, I'll just change the type cast or let the compiler use the updated type.
fs.writeFileSync('apps/api/src/adapters/payment/registry.ts', regTs);

console.log('Patch complete.');
