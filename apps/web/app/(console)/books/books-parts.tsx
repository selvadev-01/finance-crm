"use client";

import {
  type BankAccountView,
  booksContract,
  type ExpenseCategory,
} from "@repo/contracts";
import { FormField, Select } from "@repo/ui";

import { useApiQuery } from "../../../lib/use-api-query";

/** The words for office cash wherever money can be held (ADR-0018). */
export const OFFICE_CASH = "Cash in hand";

/**
 * The business's banks, retired ones included, so a past entry still shows
 * where its money went. Pickers offer only the active ones (`activeBanks`).
 */
export function useBanks(enabled: boolean) {
  return useApiQuery(
    booksContract.listBankAccounts,
    enabled ? { query: { includeRetired: "true" } } : null,
  );
}

/** Every category, retired included — the filter must reach old entries. */
export function useCategories(enabled: boolean) {
  return useApiQuery(
    booksContract.listExpenseCategories,
    enabled ? { query: { includeRetired: "true" } } : null,
  );
}

export function activeBanks(
  banks: readonly BankAccountView[],
): BankAccountView[] {
  return banks.filter((bank) => bank.isActive);
}

export function activeCategories(
  categories: readonly ExpenseCategory[],
): ExpenseCategory[] {
  return categories.filter((category) => category.isActive);
}

/** "SBI Mylapore · 4821", so two accounts at one bank tell apart. */
export function bankLabel(bank: Pick<BankAccountView, "name" | "last4">) {
  return bank.last4 ? `${bank.name} · ${bank.last4}` : bank.name;
}

/**
 * A form's choice of office cash or one active bank. On the wire office cash
 * is the empty value, which the contract reads as "no bank".
 */
export function PlaceField({
  name,
  label,
  banks,
  hint,
}: {
  name: string;
  label: string;
  banks: readonly BankAccountView[];
  hint?: string;
}) {
  return (
    <FormField name={name} label={label} hint={hint}>
      <Select>
        <option value="">{OFFICE_CASH}</option>
        {activeBanks(banks).map((bank) => (
          <option key={bank.id} value={bank.id}>
            {bankLabel(bank)}
          </option>
        ))}
      </Select>
    </FormField>
  );
}
