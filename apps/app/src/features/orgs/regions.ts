import type { PickItem } from "@/features/questions/search-picker";

/**
 * Country and currency codes for the org's and a project's defaults (review C-29). The codes are
 * the public ISO 3166-1 alpha-2 and ISO 4217 identifiers; the names come from the browser
 * (`Intl.DisplayNames`) in the person's language, so no translated list lives here.
 */
export const COUNTRY_CODES = (
  "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ " +
  "CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO " +
  "FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE " +
  "JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO " +
  "MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW " +
  "PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM " +
  "TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW"
).split(" ");

/** Currencies in use (ISO 4217, 2026); a stored code that isn't here still shows, as its code. */
export const CURRENCY_CODES = (
  "AED AFN ALL AMD AOA ARS AUD AWG AZN BAM BBD BDT BHD BIF BMD BND BOB BRL BSD BTN BWP BYN BZD CAD CDF CHF CLP CNY " +
  "COP CRC CUP CVE CZK DJF DKK DOP DZD EGP ERN ETB EUR FJD FKP GBP GEL GHS GIP GMD GNF GTQ GYD HKD HNL HTG HUF IDR " +
  "ILS INR IQD IRR ISK JMD JOD JPY KES KGS KHR KMF KPW KRW KWD KYD KZT LAK LBP LKR LRD LSL LYD MAD MDL MGA MKD MMK " +
  "MNT MOP MRU MUR MVR MWK MXN MYR MZN NAD NGN NIO NOK NPR NZD OMR PAB PEN PGK PHP PKR PLN PYG QAR RON RSD RUB RWF " +
  "SAR SBD SCR SDG SEK SGD SHP SLE SOS SRD SSP STN SVC SYP SZL THB TJS TMT TND TOP TRY TTD TWD TZS UAH UGX USD UYU " +
  "UZS VED VES VND VUV WST XAF XCD XCG XOF XPF YER ZAR ZMW ZWG"
).split(" ");

function displayNames(locale: string, type: "region" | "currency"): (code: string) => string {
  try {
    const names = new Intl.DisplayNames([locale, "en"], { type, fallback: "code" });
    return (code) => names.of(code) ?? code;
  } catch {
    return (code) => code;
  }
}

function items(codes: readonly string[], name: (code: string) => string, locale: string): PickItem[] {
  return codes.map((code) => ({ value: code, label: name(code), hint: code })).sort((a, b) => a.label.localeCompare(b.label, locale));
}

const cache = new Map<string, PickItem[]>();

/** Countries by name in `locale`, each with its code as the hint. */
export function countryItems(locale: string): PickItem[] {
  const key = `region:${locale}`;
  if (!cache.has(key)) cache.set(key, items(COUNTRY_CODES, displayNames(locale, "region"), locale));
  return cache.get(key)!;
}

/** Currencies by name in `locale`, each with its code as the hint. */
export function currencyItems(locale: string): PickItem[] {
  const key = `currency:${locale}`;
  if (!cache.has(key)) cache.set(key, items(CURRENCY_CODES, displayNames(locale, "currency"), locale));
  return cache.get(key)!;
}

/**
 * The items for a query: names that start with it first ("Ire" → Ireland before Northern…), then
 * names and codes that contain every word. Accents are ignored.
 */
export function searchItems(all: readonly PickItem[], query: string): PickItem[] {
  const fold = (text: string) => text.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const q = fold(query.trim());
  if (!q) return [...all];
  const words = q.split(/\s+/);
  const code = all.filter((i) => fold(i.value) === q);
  const starts = all.filter((i) => !code.includes(i) && fold(i.label).startsWith(q));
  const contains = all.filter((i) => !code.includes(i) && !starts.includes(i) && words.every((w) => fold(`${i.label} ${i.value}`).includes(w)));
  return [...code, ...starts, ...contains];
}
