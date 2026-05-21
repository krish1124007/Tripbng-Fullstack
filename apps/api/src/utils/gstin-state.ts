// GSTIN state-code → state-name map.
//
// The first two characters of every GSTIN encode the state of registration
// per the Goods & Services Tax Network (GSTN) state-code table. We surface
// it on flight invoices' `billTo.state` so the field isn't blank — GST
// auditors need both the code and the name.
//
// Source of truth: the GSTN list at gst.gov.in (codes 01–38 cover every
// state + UT). Last updated 2024-08 — Telangana 36 → 36 fix, Ladakh 38
// added 2020.
//
// Codes that don't appear in this table (e.g. a malformed GSTIN with
// non-numeric prefix) return null and the caller falls back to whatever
// other signal it has (Agency.state, "").

const STATE_NAME_BY_GSTIN_CODE: Record<string, string> = {
  '01': 'Jammu and Kashmir',
  '02': 'Himachal Pradesh',
  '03': 'Punjab',
  '04': 'Chandigarh',
  '05': 'Uttarakhand',
  '06': 'Haryana',
  '07': 'Delhi',
  '08': 'Rajasthan',
  '09': 'Uttar Pradesh',
  '10': 'Bihar',
  '11': 'Sikkim',
  '12': 'Arunachal Pradesh',
  '13': 'Nagaland',
  '14': 'Manipur',
  '15': 'Mizoram',
  '16': 'Tripura',
  '17': 'Meghalaya',
  '18': 'Assam',
  '19': 'West Bengal',
  '20': 'Jharkhand',
  '21': 'Odisha',
  '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh',
  '24': 'Gujarat',
  '25': 'Daman and Diu',
  '26': 'Dadra and Nagar Haveli',
  '27': 'Maharashtra',
  '28': 'Andhra Pradesh',
  '29': 'Karnataka',
  '30': 'Goa',
  '31': 'Lakshadweep',
  '32': 'Kerala',
  '33': 'Tamil Nadu',
  '34': 'Puducherry',
  '35': 'Andaman and Nicobar Islands',
  '36': 'Telangana',
  '37': 'Andhra Pradesh (New)',
  '38': 'Ladakh',
};

/** Return the Indian state/UT name for a 2-digit GSTIN state code, or null
 *  when the code isn't recognised. Accepts the raw 2-char prefix; callers
 *  pass `gstin.slice(0, 2)`. */
export function gstinStateName(stateCode: string | null | undefined): string | null {
  if (!stateCode) return null;
  const key = stateCode.trim().toUpperCase().padStart(2, '0').slice(0, 2);
  return STATE_NAME_BY_GSTIN_CODE[key] ?? null;
}
