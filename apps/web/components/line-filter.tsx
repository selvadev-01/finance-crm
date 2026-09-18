"use client";

import { organisationContract as org } from "@repo/contracts";
import { Combobox, FilterField } from "@repo/ui";

import { LIST_LIMIT } from "../lib/list-limit";
import { useApiQuery } from "../lib/use-api-query";

/**
 * "Line", as a filter: every line the viewer can see, inactive ones marked,
 * searchable by name or code. `""` is every line. Used by the customer,
 * collection and cash lists.
 */
export function LineFilter({
  value,
  onChange,
}: {
  value: string;
  onChange: (lineId: string) => void;
}) {
  const lines = useApiQuery(org.listLines, {
    query: { limit: LIST_LIMIT, includeInactive: "true" },
  });
  const options = [
    { value: "", label: "All lines" },
    ...(lines.status === "ready"
      ? lines.data.data.map((line) => ({
          value: line.id,
          label: line.isActive ? line.name : `${line.name} (inactive)`,
          hint: line.code,
        }))
      : []),
  ];
  return (
    <FilterField label="Line">
      <Combobox
        options={options}
        value={value}
        onValueChange={onChange}
        placeholder={
          lines.status === "loading" ? "Loading lines…" : "All lines"
        }
        searchPlaceholder="Search lines"
        emptyText="No line matches."
      />
    </FilterField>
  );
}
