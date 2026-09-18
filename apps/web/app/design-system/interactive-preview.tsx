"use client";

import { DotsThree } from "@phosphor-icons/react/dist/ssr";
import {
  Button,
  Card,
  Checkbox,
  Choice,
  Combobox,
  DataView,
  Description,
  DescriptionList,
  Dialog,
  DialogActions,
  Field,
  FilterBar,
  FilterField,
  formatBusinessDate,
  formatCurrency,
  Input,
  ListFooter,
  Menu,
  Select,
  Stat,
  StatGrid,
  Switch,
  Tabs,
  toast,
  Tooltip,
} from "@repo/ui";
import { useState } from "react";

import {
  displayColumn,
  identityColumn,
  moneyColumn,
  valueColumn,
} from "../../components/columns";
import { StatusBadge } from "../../components/status-badge";

const LINES = [
  { value: "", label: "All lines" },
  { value: "ln-07", label: "Market Road", hint: "LN-07 · North sector" },
  { value: "ln-08", label: "Bus Stand", hint: "LN-08 · North sector" },
  { value: "ln-11", label: "Temple Street", hint: "LN-11 · South sector" },
];

interface SampleRow {
  code: string;
  name: string;
  date: string;
  amount: string;
  status: "CORRECT" | "LOW" | "NO_PAYMENT";
}

const SAMPLE_ROWS: SampleRow[] = [
  {
    code: "ACC-0091",
    name: "Kumar Traders",
    date: "2026-09-16",
    amount: "500.00",
    status: "CORRECT",
  },
  {
    code: "ACC-0107",
    name: "Selvi Stores",
    date: "2026-09-15",
    amount: "250.00",
    status: "LOW",
  },
  {
    code: "ACC-0112",
    name: "Anbu Tea Stall",
    date: "2026-09-14",
    amount: "1200.00",
    status: "NO_PAYMENT",
  },
];

/** `DataView` with the app's column builders: sortable, cards below 768px. */
export function RecordsPreview() {
  return (
    <>
      <FilterBar actions={<Button tone="link">Clear filters</Button>}>
        <FilterField label="From" width="sm">
          <Input type="date" defaultValue="2026-09-10" />
        </FilterField>
        <FilterField label="Show" width="md">
          <Select defaultValue="">
            <option value="">Collections and corrections</option>
            <option value="ORIGINAL">Collections only</option>
          </Select>
        </FilterField>
      </FilterBar>
      <DataView
        caption="Sample collections"
        rows={SAMPLE_ROWS}
        getRowId={(row) => row.code}
        complete
        columns={[
          identityColumn<SampleRow>({
            header: "Customer",
            name: (row) => row.name,
            code: (row) => row.code,
          }),
          valueColumn<SampleRow>({
            id: "date",
            header: "Date",
            value: (row) => row.date,
            cell: (row) => formatBusinessDate(row.date),
          }),
          moneyColumn<SampleRow>({
            id: "amount",
            header: "Amount",
            amount: (row) => row.amount,
          }),
          displayColumn<SampleRow>({
            id: "status",
            header: "Status",
            align: "end",
            cell: (row) => (
              <StatusBadge kind="classification" value={row.status} />
            ),
          }),
        ]}
      />
      <ListFooter
        shown={SAMPLE_ROWS.length}
        noun="collections"
        onMore={() => {}}
      />
      <StatGrid columns={4}>
        <Stat label="Expected">{formatCurrency("30000.00")}</Stat>
        <Stat label="Collected" hint="of 60 slots">
          {formatCurrency("27850.00")}
        </Stat>
        <Stat label="Shortfall" tone="warning">
          {formatCurrency("2150.00")}
        </Stat>
        <Stat label="Cash received">{formatCurrency("27850.00")}</Stat>
      </StatGrid>
      <Card.Root>
        <Card.Header
          title="Profile"
          actions={<Button size="sm">Edit</Button>}
        />
        <Card.Body>
          <DescriptionList>
            <Description term="Mobile">+91 98765 43210</Description>
            <Description term="Line">LN-07 · Market Road</Description>
            <Description term="Notes" />
          </DescriptionList>
        </Card.Body>
      </Card.Root>
    </>
  );
}

/** The ADR-0013 interactive primitives, for the preview page. */
export function InteractivePreview() {
  const [line, setLine] = useState("");
  const [inactive, setInactive] = useState(false);
  const [agree, setAgree] = useState(true);
  const [tab, setTab] = useState("profile");
  const [open, setOpen] = useState(false);
  const [dialogLine, setDialogLine] = useState("ln-07");

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 rounded-surface border border-border bg-surface-raised p-5 md:grid-cols-2">
        <Field label="Line" hint="Type a name or a code.">
          <Combobox
            options={LINES}
            value={line}
            onValueChange={setLine}
            searchPlaceholder="Search lines"
          />
        </Field>
        <div className="flex flex-col justify-center gap-3">
          <Choice label="Show inactive">
            <Switch checked={inactive} onCheckedChange={setInactive} />
          </Choice>
          <Choice
            label="Save and add another"
            description="Keeps the line and sector for the next entry."
          >
            <Checkbox
              checked={agree}
              onCheckedChange={(next) => setAgree(next === true)}
            />
          </Choice>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button tone="primary" onClick={() => setOpen(true)}>
          Assign in a dialog
        </Button>
        <Button
          onClick={() =>
            toast({
              title: "Line LN-07 created",
              description: "Assign a Senior next.",
            })
          }
        >
          Show a toast
        </Button>
        <Menu.Root>
          <Tooltip content="More actions">
            <Menu.Trigger asChild>
              <Button tone="ghost" aria-label="More actions">
                <DotsThree aria-hidden size={18} weight="bold" />
              </Button>
            </Menu.Trigger>
          </Tooltip>
          <Menu.Content>
            <Menu.Label>LN-07 · Market Road</Menu.Label>
            <Menu.Item>Rename</Menu.Item>
            <Menu.Item>Assign a Junior</Menu.Item>
            <Menu.Separator />
            <Menu.Item tone="danger">Deactivate line</Menu.Item>
          </Menu.Content>
        </Menu.Root>
      </div>

      <Tabs.Root value={tab} onValueChange={setTab}>
        <Tabs.List aria-label="Customer">
          <Tabs.Trigger value="profile">Profile</Tabs.Trigger>
          <Tabs.Trigger value="accounts">Accounts</Tabs.Trigger>
          <Tabs.Trigger value="history">History</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="profile">
          <p className="text-body text-ink-muted">Profile panel.</p>
        </Tabs.Content>
        <Tabs.Content value="accounts">
          <p className="text-body text-ink-muted">Accounts panel.</p>
        </Tabs.Content>
        <Tabs.Content value="history">
          <p className="text-body text-ink-muted">History panel.</p>
        </Tabs.Content>
      </Tabs.Root>

      {open ? (
        <Dialog
          open
          onClose={() => setOpen(false)}
          title="Assign a Junior to LN-07"
          description="The list opens inside the dialog, above its backdrop."
        >
          <Field label="Line">
            <Combobox
              options={LINES.slice(1)}
              value={dialogLine}
              onValueChange={setDialogLine}
            />
          </Field>
          <DialogActions>
            <Button tone="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button tone="primary" onClick={() => setOpen(false)}>
              Assign
            </Button>
          </DialogActions>
        </Dialog>
      ) : null}
    </div>
  );
}
