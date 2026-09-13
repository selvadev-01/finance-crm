"use client";

import {
  customerContract,
  type CustomerDetail,
  type CustomerSummary,
  organisationContract as org,
} from "@repo/contracts";
import {
  Button,
  Field,
  FormMessage,
  Input,
  NotPermitted,
  PageHeader,
  Select,
  Textarea,
} from "@repo/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useRef, useState } from "react";
import { flushSync } from "react-dom";

import { api } from "../../../../lib/api-client";
import { apiWrite } from "../../../../lib/api-write";
import { canManageOrganisation } from "../../../../lib/roles";
import { useApiQuery } from "../../../../lib/use-api-query";
import { useSignedIn } from "../../../../lib/use-me";
import { LIST_LIMIT, Surface } from "../../_organisation/list-controls";

type Errors = Record<string, string>;

interface Duplicate {
  mobile: string;
  matches: CustomerSummary[];
}

const MAX_REFERENCES = 5;

/** Plain words for each field, whichever side found the problem. */
function messageFor(path: string, issue: string): string {
  if (path === "name") return "Enter the customer’s name.";
  if (path === "mobile") return "Enter a 10-digit mobile number.";
  if (path === "alternateMobile") return "Enter a 10-digit mobile number, or leave it empty.";
  if (path === "address") return "Enter the address.";
  if (path === "lineId") return "Choose a line.";
  if (path === "references") return "Add at least one reference person.";
  if (/^references\.\d+\.name$/.test(path)) return "Enter the reference’s name.";
  if (/^references\.\d+\.mobile$/.test(path)) return "Enter a 10-digit mobile number.";
  return `${issue[0]?.toUpperCase() ?? ""}${issue.slice(1)}.`;
}

function text(form: FormData, key: string): string {
  return String(form.get(key) ?? "");
}

/**
 * S-10 · US-020 onboarding. Throughput-critical (screen-specs.md): entered
 * 1,000+ times at launch, so it is keyboard-first, validates with the
 * contract's own schema before sending, and "Save and add another" keeps the
 * line and returns focus to the name without a page load.
 *
 * A mobile already on another customer is a warning, not a refusal: the API
 * answers `409 DUPLICATE_MOBILE`, the form shows who has the number, and
 * "Save anyway" resends with the confirmation (M04).
 */
export function NewCustomerForm() {
  const me = useSignedIn();
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const manages = canManageOrganisation(me.role);

  const lines = useApiQuery(
    org.listLines,
    manages ? { query: { limit: LIST_LIMIT } } : null,
  );

  const [formKey, setFormKey] = useState(0);
  const [lineId, setLineId] = useState("");
  const [referenceKeys, setReferenceKeys] = useState([0]);
  const [nextReferenceKey, setNextReferenceKey] = useState(1);
  const [errors, setErrors] = useState<Errors>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [duplicate, setDuplicate] = useState<Duplicate | null>(null);
  const [saved, setSaved] = useState<CustomerDetail | null>(null);

  if (!manages) {
    return (
      <Surface>
        <NotPermitted />
      </Surface>
    );
  }

  function focusFirstError() {
    formRef.current
      ?.querySelector<HTMLElement>("[aria-invalid=true]")
      ?.focus();
  }

  async function save(intent: "view" | "another", confirmDuplicateMobile: boolean) {
    const element = formRef.current;
    if (!element) return;
    const form = new FormData(element);
    const body = {
      name: text(form, "name"),
      mobile: text(form, "mobile"),
      ...(text(form, "alternateMobile").trim()
        ? { alternateMobile: text(form, "alternateMobile") }
        : {}),
      address: text(form, "address"),
      lineId,
      notes: text(form, "notes"),
      references: referenceKeys.map((_, index) => ({
        name: text(form, `references.${index}.name`),
        mobile: text(form, `references.${index}.mobile`),
        relation: text(form, `references.${index}.relation`),
      })),
      confirmDuplicateMobile,
    };

    // The contract's schema is the server's validation, so this is the same
    // answer the API would give, without the round trip.
    const checked = customerContract.createCustomer.body!.safeParse(body);
    if (!checked.success) {
      const found: Errors = {};
      for (const issue of checked.error.issues) {
        const path = issue.path.map(String).join(".");
        found[path] ??= messageFor(path, issue.message);
      }
      flushSync(() => {
        setErrors(found);
        setProblem(null);
      });
      focusFirstError();
      return;
    }

    setPending(true);
    setErrors({});
    setProblem(null);
    const result = await apiWrite(customerContract.createCustomer, { body });

    if (!result.ok) {
      if (result.code === "DUPLICATE_MOBILE") {
        const mobile = checked.data.mobile;
        const sharing = await api(customerContract.listCustomers, {
          query: { mobile, limit: 20 },
        }).catch(() => null);
        setPending(false);
        setDuplicate({
          mobile,
          matches: sharing?.ok ? sharing.body.data : [],
        });
        return;
      }
      const found: Errors = {};
      for (const detail of result.details) {
        found[detail.field] ??= messageFor(detail.field, detail.issue);
      }
      flushSync(() => {
        setPending(false);
        // A different refusal replaces the duplicate warning, never joins it.
        setDuplicate(null);
        setErrors(found);
        setProblem(Object.keys(found).length > 0 && result.code === "VALIDATION_FAILED" ? null : result.form);
      });
      focusFirstError();
      return;
    }

    setPending(false);
    setDuplicate(null);
    if (intent === "view") {
      router.push(`/customers/${result.body.id}`);
      return;
    }
    // Start the next customer: same line, empty fields, focus on the name.
    flushSync(() => {
      setSaved(result.body);
      setReferenceKeys([0]);
      setNextReferenceKey(1);
      setFormKey((key) => key + 1);
    });
    formRef.current?.querySelector<HTMLInputElement>("input[name=name]")?.focus();
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const intent =
      submitter instanceof HTMLButtonElement && submitter.value === "another"
        ? "another"
        : "view";
    void save(intent, false);
  }

  const activeLines = lines.status === "ready" ? lines.data.data : [];

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/customers" className="hover:text-ink hover:underline">
            Customers
          </Link>
        }
        title="New customer"
        description="Every customer needs at least one reference person."
      />

      {saved ? (
        <FormMessage tone="info">
          Saved {saved.name} as{" "}
          <Link href={`/customers/${saved.id}`} className="font-medium underline">
            {saved.customerCode}
          </Link>
          . Enter the next customer.
        </FormMessage>
      ) : null}

      <form
        key={formKey}
        ref={formRef}
        onSubmit={submit}
        noValidate
        className="flex max-w-3xl flex-col gap-6"
      >
        {problem ? <FormMessage tone="critical">{problem}</FormMessage> : null}

        <fieldset className="flex flex-col gap-[var(--stack-gap)]" disabled={pending}>
          <legend className="mb-2 text-base font-semibold text-ink">Customer</legend>
          <Field label="Name" error={errors.name}>
            <Input name="name" autoComplete="off" autoFocus maxLength={120} />
          </Field>
          <div className="grid gap-[var(--stack-gap)] sm:grid-cols-2">
            <Field label="Mobile" hint="10 digits, e.g. 98765 43210" error={errors.mobile}>
              <Input
                name="mobile"
                type="tel"
                inputMode="tel"
                autoComplete="off"
                onChange={() => setDuplicate(null)}
              />
            </Field>
            <Field label="Alternate mobile (optional)" error={errors.alternateMobile}>
              <Input name="alternateMobile" type="tel" inputMode="tel" autoComplete="off" />
            </Field>
          </div>
          <Field label="Address" error={errors.address}>
            <Textarea name="address" maxLength={300} />
          </Field>
          <Field
            label="Line"
            hint={lines.status === "ready" && activeLines.length === 0 ? "There are no active lines. Create one first." : "Kept for the next customer."}
            error={errors.lineId}
          >
            <Select
              name="lineId"
              value={lineId}
              onChange={(event) => setLineId(event.target.value)}
            >
              <option value="">Choose a line</option>
              {activeLines.map((line) => (
                <option key={line.id} value={line.id}>
                  {line.name} ({line.code})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Notes (optional)">
            <Textarea name="notes" rows={2} maxLength={1000} />
          </Field>
        </fieldset>

        <fieldset className="flex flex-col gap-[var(--stack-gap)]" disabled={pending}>
          <legend className="mb-2 text-base font-semibold text-ink">
            Reference persons
          </legend>
          {errors.references ? (
            <p className="text-sm text-critical" role="alert">
              {errors.references}
            </p>
          ) : null}
          {referenceKeys.map((key, index) => (
            <div
              key={key}
              className="flex flex-col gap-[var(--stack-gap)] rounded-[var(--radius-surface)] border border-border bg-surface-raised p-4"
            >
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-ink">Reference {index + 1}</p>
                {referenceKeys.length > 1 ? (
                  <Button
                    tone="ghost"
                    onClick={() =>
                      setReferenceKeys((keys) => keys.filter((each) => each !== key))
                    }
                  >
                    Remove
                  </Button>
                ) : null}
              </div>
              <div className="grid gap-[var(--stack-gap)] sm:grid-cols-3">
                <Field label="Name" error={errors[`references.${index}.name`]}>
                  <Input name={`references.${index}.name`} autoComplete="off" maxLength={120} />
                </Field>
                <Field label="Mobile" error={errors[`references.${index}.mobile`]}>
                  <Input name={`references.${index}.mobile`} type="tel" inputMode="tel" autoComplete="off" />
                </Field>
                <Field label="Relation (optional)" hint="e.g. brother, shop owner">
                  <Input name={`references.${index}.relation`} autoComplete="off" maxLength={80} />
                </Field>
              </div>
            </div>
          ))}
          {referenceKeys.length < MAX_REFERENCES ? (
            <div>
              <Button
                onClick={() => {
                  setReferenceKeys((keys) => [...keys, nextReferenceKey]);
                  setNextReferenceKey((key) => key + 1);
                }}
              >
                Add another reference
              </Button>
            </div>
          ) : null}
        </fieldset>

        {duplicate ? (
          <div
            role="alert"
            className="flex flex-col gap-3 rounded-[var(--radius-surface)] border border-warning/40 bg-warning-subtle p-4 text-sm text-ink"
          >
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
                    <span className="text-ink-muted">on {match.lineName}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="text-ink-muted">
              Families and shops often share a number. If this is a different
              person, save anyway.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button tone="primary" onClick={() => void save("view", true)} disabled={pending}>
                Save anyway
              </Button>
              <Button onClick={() => void save("another", true)} disabled={pending}>
                Save anyway and add another
              </Button>
            </div>
          </div>
        ) : (
          // "Save customer" comes first in the DOM so Enter submits it; the
          // row is reversed so it still sits rightmost.
          <div className="flex flex-col gap-2 sm:flex-row-reverse sm:justify-start">
            <Button tone="primary" type="submit" value="view" disabled={pending}>
              {pending ? "Saving…" : "Save customer"}
            </Button>
            <Button
              tone="secondary"
              type="submit"
              value="another"
              disabled={pending}
            >
              Save and add another
            </Button>
          </div>
        )}
      </form>
    </>
  );
}
