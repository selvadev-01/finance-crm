"use client";

import { customerContract, type CustomerSummary } from "@repo/contracts";
import { Combobox, Field } from "@repo/ui";
import { useEffect, useState } from "react";

import { formatMobile } from "../lib/format";
import { useApiQuery } from "../lib/use-api-query";

/** The customer list's own delay (US-024), so every search box feels the same. */
const SEARCH_DELAY_MS = 300;
/** One character matches nearly everything; it costs a read to find out. */
const MIN_QUERY = 2;
/** Enough to tell two Lakshmis apart without a scrolling list. */
const RESULTS = 8;

/**
 * Pick a customer the caller can already see (`customer.view`, inside
 * `customerScope`), searched by name, customer code or mobile exactly as
 * US-024 searches. The search is answered by the API, not filtered here:
 * there are a thousand customers and only the matches come back.
 *
 * It chooses a customer; what the screen then does with them is the screen's
 * own business — on S-10 it copies their name and mobile into a reference
 * person. Nothing here is a new permission: a customer this caller cannot
 * list cannot be found.
 */
export function CustomerPicker({
  label,
  hint,
  selected,
  onSelect,
  disabled,
}: {
  label: string;
  hint?: string;
  /** The customer already chosen, so the control still reads correctly. */
  selected: CustomerSummary | null;
  onSelect: (customer: CustomerSummary) => void;
  disabled?: boolean;
}) {
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    const next = text.trim();
    if (next === query) return;
    const timer = setTimeout(() => setQuery(next), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [text, query]);

  const searching = query.length >= MIN_QUERY;
  const found = useApiQuery(
    customerContract.listCustomers,
    searching ? { query: { q: query, limit: RESULTS } } : null,
  );
  const matches = found.status === "ready" ? found.data.data : [];

  return (
    <Field label={label} hint={hint}>
      <Combobox
        options={matches.map((customer) => ({
          value: customer.id,
          label: customer.name,
          hint: `${customer.customerCode} · ${formatMobile(customer.mobile)} · ${customer.lineName}`,
        }))}
        value={selected?.id ?? ""}
        selectedLabel={
          selected ? `${selected.name} · ${selected.customerCode}` : undefined
        }
        onValueChange={(id) => {
          const match = matches.find((customer) => customer.id === id);
          if (match) onSelect(match);
        }}
        search={text}
        onSearchChange={setText}
        loading={searching && found.status === "loading"}
        disabled={disabled}
        placeholder="Search for a customer"
        searchPlaceholder="Name, customer code or mobile"
        emptyText={
          !searching
            ? "Type a name, customer code or mobile."
            : found.status === "error"
              ? "This couldn’t be searched just now. Try again in a moment."
              : `No customer matches “${query}”.`
        }
      />
    </Field>
  );
}
