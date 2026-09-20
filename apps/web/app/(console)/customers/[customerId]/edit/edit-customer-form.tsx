"use client";

import {
  customerContract,
  type CustomerDetail,
  type CustomerSummary,
  customerStatusSchema,
} from "@repo/contracts";
import {
  Button,
  buttonClass,
  Card,
  EmptyFrame,
  Form,
  FormActions,
  FormField,
  FormMessage,
  FormRootError,
  Input,
  NotPermitted,
  PageHeader,
  Select,
  SubmitButton,
  Textarea,
  toast,
  useZodForm,
} from "@repo/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useFieldArray } from "react-hook-form";

import { PageTrail } from "../../../../../components/page-trail";
import { RecordFallback } from "../../../../../components/query-state";
import { STATUS } from "../../../../../components/status-badge";
import { api } from "../../../../../lib/api-client";
import { apiWrite } from "../../../../../lib/api-write";
import { applyWriteFailure } from "../../../../../lib/form-errors";
import { formatMobile } from "../../../../../lib/format";
import { canManageOrganisation } from "../../../../../lib/roles";
import { useApiQuery } from "../../../../../lib/use-api-query";
import { useSignedIn } from "../../../../../lib/use-me";

const schema = customerContract.updateCustomer.body;
type Values = typeof schema._zod.output;
const MAX_REFERENCES = 5;

const emptyReference = { name: "", mobile: "", relation: "" };

/**
 * The form's starting values: the record as it stands. Mobiles are shown as
 * they are read elsewhere (`+91 98100 00068`) rather than as stored; the
 * contract's schema strips the spaces again on the way back.
 */
function current(customer: CustomerDetail) {
  return {
    name: customer.name,
    mobile: formatMobile(customer.mobile),
    alternateMobile: customer.alternateMobile
      ? formatMobile(customer.alternateMobile)
      : undefined,
    address: customer.address,
    notes: customer.notes ?? "",
    status: customer.status,
    references: customer.references.map((reference) => ({
      id: reference.id,
      name: reference.name,
      mobile: formatMobile(reference.mobile),
      relation: reference.relation ?? "",
      address: reference.address ?? undefined,
    })),
    confirmDuplicateMobile: false,
  };
}

/**
 * US-021 · edit a customer. Loads the record, then hands it to the form so
 * the form's defaults are the saved values, never a blank flash.
 */
export function EditCustomerForm({ customerId }: { customerId: string }) {
  const me = useSignedIn();
  const manages = canManageOrganisation(me.role);
  const customer = useApiQuery(
    customerContract.getCustomer,
    manages ? { params: { customerId } } : null,
  );

  if (!manages) {
    return (
      <EmptyFrame>
        <NotPermitted />
      </EmptyFrame>
    );
  }
  if (customer.status !== "ready")
    return <RecordFallback query={customer} noun="Customer" />;
  return <CustomerEditor customer={customer.data} />;
}

interface Duplicate {
  matches: CustomerSummary[];
}

/**
 * The line is not edited here: moving a customer is a transfer (US-023),
 * which keeps past collections on the old line (BR-15). A mobile that changes
 * to one already on another customer is warned, as at onboarding (M04).
 */
function CustomerEditor({ customer }: { customer: CustomerDetail }) {
  const router = useRouter();
  const [duplicate, setDuplicate] = useState<Duplicate | null>(null);
  const form = useZodForm(schema, { defaultValues: current(customer) });
  // `id` is the saved reference's id, so the array's own key must not use it.
  const references = useFieldArray({
    control: form.control,
    name: "references",
    keyName: "fieldKey",
  });
  const profile = `/customers/${customer.id}`;

  async function save(values: Values, confirmDuplicateMobile: boolean) {
    const result = await apiWrite(customerContract.updateCustomer, {
      params: { customerId: customer.id },
      body: { ...values, confirmDuplicateMobile },
    });

    if (!result.ok) {
      if (result.code === "DUPLICATE_MOBILE") {
        const sharing = await api(customerContract.listCustomers, {
          query: { mobile: values.mobile, limit: 20 },
        }).catch(() => null);
        setDuplicate({
          matches: sharing?.ok
            ? sharing.body.data.filter((match) => match.id !== customer.id)
            : [],
        });
        return;
      }
      setDuplicate(null);
      applyWriteFailure(form.setError, result, {
        fields: [
          "name",
          "mobile",
          "alternateMobile",
          "address",
          "notes",
          "status",
          ...values.references.flatMap((_, index) => [
            `references.${index}.name` as const,
            `references.${index}.mobile` as const,
            `references.${index}.relation` as const,
          ]),
        ],
        fallback: "The changes were not saved.",
      });
      return;
    }

    toast({ title: `Saved ${result.body.name}` });
    router.push(profile);
  }

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
              { label: customer.name, href: profile },
              { label: "Edit" },
            ]}
          />
        }
        title={`Edit ${customer.name}`}
        meta={<span className="font-mono">{customer.customerCode}</span>}
      />

      <Form
        form={form}
        onSubmit={(values) => save(values, false)}
        className="max-w-3xl gap-6"
      >
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
            <FormField
              name="status"
              label="Status"
              hint="Collection continues whatever the status. Blacklisted customers are not given new accounts."
            >
              <Select>
                {customerStatusSchema.options.map((status) => (
                  <option key={status} value={status}>
                    {STATUS.customer[status].label}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField name="notes" label="Notes (optional)" valueAs="optional">
              <Textarea rows={2} maxLength={1000} />
            </FormField>
            <p className="text-body text-ink-muted">
              Line: <span className="text-ink">{customer.lineName}</span>.
              Moving a customer to another line is a transfer, not an edit.
            </p>
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
              {references.fields.map((reference, index) => (
                <li
                  key={reference.fieldKey}
                  className="flex flex-col gap-3 p-4"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-label text-ink-muted">
                      Reference {index + 1}
                    </p>
                    {references.fields.length > 1 ? (
                      <Button
                        tone="ghost"
                        size="sm"
                        onClick={() => references.remove(index)}
                        disabled={pending}
                      >
                        Remove
                      </Button>
                    ) : null}
                  </div>
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
                </li>
              ))}
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
                    void form.handleSubmit((values) => save(values, true))()
                  }
                >
                  Save anyway
                </Button>
                <Button disabled={pending} onClick={() => setDuplicate(null)}>
                  Change the number
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
          <FormActions className="sm:flex-row-reverse sm:justify-start">
            <SubmitButton pendingLabel="Saving…">Save changes</SubmitButton>
            <Link href={profile} className={buttonClass("secondary")}>
              Cancel
            </Link>
          </FormActions>
        )}
      </Form>
    </>
  );
}
