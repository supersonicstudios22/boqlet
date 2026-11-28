"use client";

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import { SearchPicker, type PickItem } from "@/features/questions/search-picker";
import { countryItems, currencyItems, searchItems } from "./regions";

type PickerProps = {
  id: string;
  value: string;
  onChange: (code: string) => void;
  /** Offer "Not set" (an optional field). */
  optional?: boolean;
  disabled?: boolean;
  "data-testid"?: string;
};

/**
 * Searchable country and currency fields (review C-29): type a name or a code ("Ireland", "IE"),
 * pick with Enter or a click. The value is the code; nothing is cut to the code's length.
 */
export function CountryPicker(props: PickerProps) {
  const locale = useLocale();
  return <CodePicker {...props} items={countryItems(locale)} kind="country" />;
}

export function CurrencyPicker(props: PickerProps) {
  const locale = useLocale();
  return <CodePicker {...props} items={currencyItems(locale)} kind="currency" />;
}

function CodePicker({
  id,
  value,
  onChange,
  optional,
  disabled,
  items,
  kind,
  "data-testid": testId,
}: PickerProps & { items: PickItem[]; kind: "country" | "currency" }) {
  const t = useTranslations("orgs.codes");
  const all = useMemo(() => {
    const known = items.some((i) => i.value === value);
    // A stored code that isn't in the list (an older currency) still shows, as its code.
    const stored = value && !known ? [{ value, label: value }] : [];
    return [...(optional ? [{ value: "", label: t("notSet") }] : []), ...stored, ...items];
  }, [items, optional, t, value]);
  return (
    <SearchPicker
      inputId={id}
      items={all}
      value={value}
      onPick={onChange}
      search={(query) => (query.trim() ? searchItems(all.filter((i) => i.value !== ""), query) : all)}
      label={t(kind)}
      placeholder={optional ? t("notSet") : t(`${kind}Placeholder`)}
      empty={t("none")}
      disabled={disabled}
      className="min-w-0"
      data-testid={testId}
    />
  );
}
