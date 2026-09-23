"use client";

import {
  customerContract,
  type CustomerDetail,
  type CustomerSummary,
  organisationContract as org,
} from "@repo/contracts";
import {
  Button,
  Card,
  Combobox,
  EmptyFrame,
  Form,
  FormActions,
  FormControlField,
  FormField,
  FormMessage,
  FormRootError,
  Input,
  NotPermitted,
  PageHeader,
  SubmitButton,
  Textarea,
  toast,
  useZodForm,
} from "@repo/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type BaseSyntheticEvent, useState } from "react";
import { useFieldArray } from "react-hook-form";

import { CustomerPicker } from "../../../../components/customer-picker";
import { PageTrail } from "../../../../components/page-trail";
import { api } from "../../../../lib/api-client";
import { apiWrite } from "../../../../lib/api-write";
import { applyWriteFailure } from "../../../../lib/form-errors";
import { formatMobile } from "../../../../lib/format";
import { LIST_LIMIT } from "../../../../lib/list-limit";
import { canManageOrganisation } from "../../../../lib/roles";
import { useApiQuery } from "../../../../lib/use-api-query";
import { useSignedIn } from "../../../../lib/use-me";

const schema = customerContract.createCustomer.body;
const MAX_REFERENCES = 5;
/** The line is kept for the next customer, across reloads in this tab. */
const LINE_KEY = "rasi:new-customer:line";

const emptyReference = { name: "", mobile: "", relation: "" };

function blank(lineId: string) {
  return {
    name: "",
    mobile: "",
    alternateMobile: undefined,
    address: "",
    lineId,
    notes: "",
    references: [emptyReference],
    confirmDuplicateMobile: false,
  };
}

function rememberedLine(): string {
  try {
    return typeof window === "undefined"
      ? ""
      : (window.sessionStorage.getItem(LINE_KEY) ?? "");
  } catch {
    return "";
  }
}

interface Duplicate {
  mobile: string;
  matches: CustomerSummary[];
}

type Intent = "view" | "another";

/**
 * S-10 · US-020 onboarding. Throughput-critical (screen-specs.md): entered
 * 1,000+ times at launch, so it is keyboard-first, validates with the
 * contract's own schema at each field as it is left, and "Save and add
 * another" keeps the line and returns focus to the name without a page load.
 *
 * A mobile already on another customer is a warning, not a refusal: the API
 * answers `409 DUPLICATE_MOBILE`, the form shows who has the number, and
 * "Save anyway" resends with the confirmation (M04).
 */
export function NewCustomerForm() {
  const me = useSignedIn();
  const router = useRouter();
  const manages = canManageOrganisation(me.role);
  const lines = useApiQuery(
    org.listLines,
    manages ? { query: { limit: LIST_LIMIT } } : null,
  );
  const [duplicate, setDuplicate] = useState<Duplicate | null>(null);
  const [saved, setSaved] = useState<CustomerDetail | null>(null);
  // Which existing customer filled each reference row, by the field array's
  // own key: it survives a row above being removed, which an index does not.
  const [copied, setCopied] = useState<Record<string, CustomerSummary>>({});

  const form = useZodForm(schema, { defaultValues: blank(rememberedLine()) });
  const references = useFieldArray({
    control: form.control,
    name: "references",
  });

  /**
   * A reference person is very often a customer already on the books — a
   * brother on the same line, the shop owner opposite. Choosing them fills
   * their name and mobile rather than having them typed a second time, with
   * every field still editable: it is a copy, not a link, because the
   * reference is the customer's own record (M04) and must not change when
   * that other customer is edited.
   */
  function copyReference(
    index: number,
    rowKey: string,
    customer: CustomerSummary,
  ) {
    const filled = { shouldValidate: true, shouldDirty: true };
    form.setValue(`references.${index}.name`, customer.name, filled);
    form.setValue(
      `references.${index}.mobile`,
      formatMobile(customer.mobile),
      filled,
    );
    setCopied((rows) => ({ ...rows, [rowKey]: customer }));
  }

  function removeReference(index: number, rowKey: string) {
    references.remove(index);
    setCopied(({ [rowKey]: _dropped, ...rest }) => rest);
  }

  if (!manages) {
    return (
      <EmptyFrame>
        <NotPermitted />
      </EmptyFrame>
    );
  }

  async function save(
    values: typeof schema._zod.output,
    intent: Intent,
    confirmDuplicateMobile: boolean,
  ) {
    const result = await apiWrite(customerContract.createCustomer, {
      body: { ...values, confirmDuplicateMobile },
    });

    if (!result.ok) {
      if (result.code === "DUPLICATE_MOBILE") {
        const sharing = await api(customerContract.listCustomers, {
          query: { mobile: values.mobile, limit: 20 },
        }).catch(() => null);
        setDuplicate({
          mobile: values.mobile,
          matches: sharing?.ok ? sharing.body.data : [],
        });
        return;
      }
      // A different refusal replaces the duplicate warning, never joins it.
      setDuplicate(null);
      applyWriteFailure(form.setError, result, {
        fields: [
          "name",
          "mobile",
          "alternateMobile",
          "address",
          "lineId",
          "notes",
          ...values.references.flatMap((_, index) => [
            `references.${index}.name` as const,
            `references.${index}.mobile` as const,
            `references.${index}.relation` as const,
          ]),
        ],
        fallback: "The customer was not saved.",
      });
      return;
    }

    setDuplicate(null);
    try {
      window.sessionStorage.setItem(LINE_KEY, values.lineId);
    } catch {
      // Remembering the line is a convenience; private browsing may refuse it.
    }
    if (intent === "view") {
      router.push(`/customers/${result.body.id}`);
      return;
    }
    // Start the next customer: same line, empty fields, focus on the name.
    toast({
      title: `Saved ${result.body.name}`,
      description: result.body.customerCode,
    });
    setSaved(result.body);
    form.reset(blank(values.lineId));
    setCopied({});
    form.setFocus("name");
  }

  function onSubmit(
    values: typeof schema._zod.output,
    event?: BaseSyntheticEvent,
  ) {
    const submitter = (event?.nativeEvent as SubmitEvent | undefined)
      ?.submitter;
    const intent: Intent =
      submitter instanceof HTMLButtonElement && submitter.value === "another"
        ? "another"
        : "view";
    return save(values, intent, false);
  }

  const activeLines = lines.status === "ready" ? lines.data.data : [];
  const lineOptions = activeLines.map((line) => ({
    value: line.id,
    label: line.name,
    hint: line.code,
  }));
  const pending = form.formState.isSubmitting;
  const referencesError =
    form.formState.errors.references?.root?.message ??
    form.formState.errors.references?.message;

  return (
    <>
      <PageHeader
        trail={
          <PageTrail
            steps={[
              { label: "Customers", href: "/customers" },
              { label: "New customer" },
            ]}
          />
        }
        title="New customer"
        description="Every customer needs at least one reference person."
      />

      {saved ? (
        <FormMessage tone="info">
          Saved {saved.name} as{" "}
          <Link
            href={`/customers/${saved.id}`}
            className="font-medium underline"
          >
            {saved.customerCode}
          </Link>
          . Enter the next customer.
        </FormMessage>
      ) : null}

      <Form form={form} onSubmit={onSubmit} className="max-w-3xl gap-6">
        <FormRootError />

        <Card.Root>
          <Card.Header title="Customer" />
          <Card.Body>
            <FormField name="name" label="Name">
              <Input autoComplete="off" autoFocus maxLength={120} />
            </FormField>
            <div className="grid gap-[var(--stack-gap)] sm:grid-cols-2">
              <FormField
                name="mobile"
                label="Mobile"
                hint="10 digits, e.g. 98765 43210"
              >
                <Input
                  type="tel"
                  inputMode="tel"
                  autoComplete="off"
                  onInput={() => setDuplicate(null)}
                />
              </FormField>
              <FormField
                name="alternateMobile"
                label="Alternate mobile (optional)"
                valueAs="optional"
              >
                <Input type="tel" inputMode="tel" autoComplete="off" />
              </FormField>
            </div>
            <FormField name="address" label="Address">
              <Textarea maxLength={300} />
            </FormField>
            <FormControlField
              name="lineId"
              label="Line"
              hint={
                lines.status === "ready" && activeLines.length === 0
                  ? "There are no active lines. Create one first."
                  : "Kept for the next customer."
              }
            >
              {({ field, control }) => (
                <Combobox
                  {...control}
                  options={lineOptions}
                  value={field.value}
                  onValueChange={(value) => {
                    field.onChange(value);
                    field.onBlur();
                  }}
                  placeholder={
                    lines.status === "loading"
                      ? "Loading lines…"
                      : "Choose a line"
                  }
                  searchPlaceholder="Search lines"
                  emptyText="No active line matches."
                />
              )}
            </FormControlField>
            <FormField name="notes" label="Notes (optional)" valueAs="optional">
              <Textarea rows={2} maxLength={1000} />
            </FormField>
          </Card.Body>
        </Card.Root>

        <Card.Root>
          <Card.Header
            title="Reference persons"
            actions={
              references.fields.length < MAX_REFERENCES ? (
                <Button
                  size="sm"
                  onClick={() => references.append(emptyReference)}
                  disabled={pending}
                >
                  Add another reference
                </Button>
              ) : null
            }
          />
          <Card.Body className="gap-0 p-0">
            {referencesError ? (
              <div className="p-4">
                <FormMessage tone="critical">{referencesError}</FormMessage>
              </div>
            ) : null}
            <ol className="flex flex-col divide-y divide-border">
              {references.fields.map((reference, index) => {
                const source = copied[reference.id] ?? null;
                return (
                  <li key={reference.id} className="flex flex-col gap-3 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-label text-ink-muted">
                        Reference {index + 1}
                      </p>
                      {references.fields.length > 1 ? (
                        <Button
                          tone="ghost"
                          size="sm"
                          onClick={() => removeReference(index, reference.id)}
                          disabled={pending}
                        >
                          Remove
                        </Button>
                      ) : null}
                    </div>
                    <CustomerPicker
                      label="An existing customer (optional)"
                      hint="Fills in their name and mobile. For anybody else, type the details below."
                      selected={source}
                      disabled={pending}
                      onSelect={(customer) =>
                        copyReference(index, reference.id, customer)
                      }
                    />
                    <div className="grid gap-[var(--stack-gap)] sm:grid-cols-3">
                      <FormField name={`references.${index}.name`} label="Name">
                        <Input autoComplete="off" maxLength={120} />
                      </FormField>
                      <FormField
                        name={`references.${index}.mobile`}
                        label="Mobile"
                      >
                        <Input type="tel" inputMode="tel" autoComplete="off" />
                      </FormField>
                      <FormField
                        name={`references.${index}.relation`}
                        label="Relation (optional)"
                        hint="e.g. brother, shop owner"
                        valueAs="optional"
                      >
                        <Input autoComplete="off" maxLength={80} />
                      </FormField>
                    </div>
                    {source ? (
                      <p className="text-caption text-ink-muted">
                        Copied from{" "}
                        <Link
                          href={`/customers/${source.id}`}
                          target="_blank"
                          className="font-medium underline"
                        >
                          {source.name} ({source.customerCode})
                        </Link>
                        . Edit anything that differs — this is a copy, not a
                        link, so it does not change when they do.
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          </Card.Body>
        </Card.Root>

        {duplicate ? (
          <FormMessage
            tone="warning"
            action={
              <>
                <Button
                  tone="primary"
                  disabled={pending}
                  onClick={() =>
                    void form.handleSubmit((values) =>
                      save(values, "view", true),
                    )()
                  }
                >
                  Save anyway
                </Button>
                <Button
                  disabled={pending}
                  onClick={() =>
                    void form.handleSubmit((values) =>
                      save(values, "another", true),
                    )()
                  }
                >
                  Save anyway and add another
                </Button>
              </>
            }
          >
            <div className="flex flex-col gap-2">
              <p className="font-medium">
                This mobile number is already used by{" "}
                {duplicate.matches.length === 1
                  ? "another customer"
                  : `${duplicate.matches.length || "other"} customers`}
                .
              </p>
              {duplicate.matches.length > 0 ? (
                <ul className="flex flex-col gap-1">
                  {duplicate.matches.map((match) => (
                    <li key={match.id}>
                      <Link
                        href={`/customers/${match.id}`}
                        target="_blank"
                        className="font-medium underline"
                      >
                        {match.name} ({match.customerCode})
                      </Link>{" "}
                      <span className="text-ink-muted">
                        on {match.lineName}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
              <p className="text-ink-muted">
                Families and shops often share a number. If this is a different
                person, save anyway.
              </p>
            </div>
          </FormMessage>
        ) : (
          // "Save customer" comes first in the DOM so Enter submits it; the
          // row is reversed so it still sits rightmost.
          <FormActions className="sm:flex-row-reverse sm:justify-start">
            <SubmitButton value="view" pendingLabel="Saving…">
              Save customer
            </SubmitButton>
            <SubmitButton
              tone="secondary"
              value="another"
              pendingLabel="Saving…"
            >
              Save and add another
            </SubmitButton>
          </FormActions>
        )}
      </Form>
    </>
  );
}
