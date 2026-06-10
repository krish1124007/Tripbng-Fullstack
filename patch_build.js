const fs = require('fs');
const path = require('path');

// 2. Fix packages/shared/src/schemas/index.ts
let schemasIndex = fs.readFileSync('packages/shared/src/schemas/index.ts', 'utf8');
if (!schemasIndex.includes('map-policy.js')) {
    fs.writeFileSync('packages/shared/src/schemas/index.ts', schemasIndex + "\nexport * from './map-policy.js';\n");
}

// 3. Fix packages/shared/src/schemas/payments.ts
let paymentsTs = fs.readFileSync('packages/shared/src/schemas/payments.ts', 'utf8');
paymentsTs = paymentsTs.replace(
    /export const PAYMENT_PROVIDER = \['ICICI_EAZYPAY', 'ORANGE_PG', 'PHONEPE', 'MANUAL'\] as const;/,
    "export const PAYMENT_PROVIDER = ['ICICI_EAZYPAY', 'ORANGE_PG', 'PHONEPE', 'MANUAL', 'ICICI_ORANGE_PG'] as const;"
);
paymentsTs = paymentsTs.replace(
    /export const TOPUP_METHOD = \[\s*'ICICI_EAZYPAY',\s*'ORANGE_PG',\s*'PHONEPE',\s*'MANUAL_NEFT',\s*'MANUAL_UPI',\s*'MANUAL_CASH',\s*\]\s*as const;/,
    "export const TOPUP_METHOD = ['ICICI_EAZYPAY', 'ORANGE_PG', 'PHONEPE', 'MANUAL_NEFT', 'MANUAL_UPI', 'MANUAL_CASH', 'ICICI_ORANGE_PG'] as const;"
);
paymentsTs = paymentsTs.replace(
    /providerCode: z\.enum\(\['ICICI_EAZYPAY', 'ORANGE_PG', 'PHONEPE'\]\),/,
    "providerCode: z.enum(['ICICI_EAZYPAY', 'ORANGE_PG', 'PHONEPE', 'ICICI_ORANGE_PG']),"
);
fs.writeFileSync('packages/shared/src/schemas/payments.ts', paymentsTs);

// 4. Fix apps/api/src/adapters/payment/registry.ts
let registryTs = fs.readFileSync('apps/api/src/adapters/payment/registry.ts', 'utf8');
registryTs = registryTs.replace(
    /import \{\s*IciciEazypayProvider,\s*type IciciEazypayConfig,\s*type IciciEazypayCredentials,\s*\} from '.\/icici-eazypay\.provider\.js';/g,
    "import { IciciOrangePgProvider } from './icici-orange-pg/provider.js';\nimport type { IciciOrangePgConfig, IciciOrangePgCredentials } from './icici-orange-pg/types.js';"
);
registryTs = registryTs.replace(/IciciEazypayProvider/g, 'IciciOrangePgProvider');
registryTs = registryTs.replace(/IciciEazypayConfig/g, 'IciciOrangePgConfig');
registryTs = registryTs.replace(/IciciEazypayCredentials/g, 'IciciOrangePgCredentials');
fs.writeFileSync('apps/api/src/adapters/payment/registry.ts', registryTs);

// 5. Fix apps/api/src/data/airports.ts
let airportsTs = fs.readFileSync('apps/api/src/data/airports.ts', 'utf8');
if (!airportsTs.includes('deriveTravelType')) {
    const fn = `
const IATA_TO_COUNTRY: Map<string, string> = new Map(
  GENERATED.map((a) => [a.iata.toUpperCase(), a.countryCode.toUpperCase()]),
);

export function deriveTravelType(
  originIata: string,
  destinationIata: string,
): 'DOMESTIC' | 'INTERNATIONAL' {
  const o = IATA_TO_COUNTRY.get(originIata.toUpperCase());
  const d = IATA_TO_COUNTRY.get(destinationIata.toUpperCase());
  if (!o || !d) return 'DOMESTIC';
  return o === 'IN' && d === 'IN' ? 'DOMESTIC' : 'INTERNATIONAL';
}
`;
    fs.writeFileSync('apps/api/src/data/airports.ts', airportsTs + fn);
}

// 6. Fix apps/api/src/services/search.service.ts
let searchTs = fs.readFileSync('apps/api/src/services/search.service.ts', 'utf8');
if (!searchTs.includes('applyMapSourceFilter')) {
    const searchImports = `
import { applyMapSourceFilter } from './search/map-source-filter.service.js';
import { resolveMapPolicy, applyMapPolicyToBreakdown, logMapPolicyApplied } from './pricing/map-policy-pricing.service.js';
import { resolveSupplierCommissionPaise } from './pricing/supplier-commission.service.js';
import { deriveTravelType } from '../data/airports.js';
`;
    searchTs = searchTs.replace(/import \{ Agency \} from '..\/models\/Agency.js';/, "import { Agency } from '../models/Agency.js';" + searchImports);
    fs.writeFileSync('apps/api/src/services/search.service.ts', searchTs);
}

// 7. Fix apps/api/src/services/reports.service.ts
let reportsTs = fs.readFileSync('apps/api/src/services/reports.service.ts', 'utf8');
if (!reportsTs.includes('readAgencyBalances')) {
    reportsTs = "import { readAgencyBalances } from './wallet/balance-reader.js';\n" + reportsTs;
    fs.writeFileSync('apps/api/src/services/reports.service.ts', reportsTs);
}

console.log('Build errors patched');
