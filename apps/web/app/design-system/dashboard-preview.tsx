"use client";

import {
  CalendarX,
  HandCoins,
  MapTrifold,
  Target,
  Warning,
} from "@phosphor-icons/react/dist/ssr";
import {
  ActivityList,
  AreaChart,
  Badge,
  Card,
  DeltaChip,
  formatBusinessDate,
  formatCurrency,
  HealthCard,
  Meter,
  RadialMeter,
  Stat,
  StatGrid,
} from "@repo/ui";

const TREND = [
  ["2026-09-07", "18400.00", "17250.00"],
  ["2026-09-08", "18400.00", "18900.00"],
  ["2026-09-09", "18400.00", "16120.00"],
  ["2026-09-10", "18900.00", "18900.00"],
  ["2026-09-11", "18900.00", "17640.00"],
  ["2026-09-12", "18900.00", "19310.00"],
  ["2026-09-14", "18900.00", "18020.00"],
  ["2026-09-15", "19400.00", "18480.00"],
] as const;

/**
 * The dashboards' pieces (ADR-0015), with sample figures: KPI tiles, rings,
 * the trend chart, health cards and an activity list, on flat surfaces.
 */
export function DashboardPreview() {
  return (
    <div className="flex flex-col gap-4 rounded-surface bg-surface p-4">
      <div className="flex flex-wrap items-center gap-5">
        <RadialMeter
          value={951}
          label="Collected of expected"
          valueText="95.1%"
          caption="Collected"
        />
        <RadialMeter
          value={667}
          label="Lines closed"
          valueText="66.7%"
          caption="Lines closed"
          tone="positive"
        />
      </div>
      <StatGrid columns={4} frame="tiles">
        <Stat label="Expected" icon={<Target />} hint="due across every line">
          {formatCurrency("19400.00")}
        </Stat>
        <Stat
          label="Collected"
          icon={<HandCoins />}
          iconTone="positive"
          delta={
            <DeltaChip direction="up" tone="positive" comparedWith="vs Mon">
              +₹460.00
            </DeltaChip>
          }
          hint={
            <Meter
              value={951}
              label="Collected of expected"
              valueText="95.1%"
            />
          }
        >
          {formatCurrency("18480.00")}
        </Stat>
        <Stat
          label="Pending"
          icon={<Warning />}
          iconTone="warning"
          tone="warning"
        >
          {formatCurrency("920.00")}
        </Stat>
        <Stat label="Lines not closed" icon={<CalendarX />} iconTone="info">
          2
        </Stat>
      </StatGrid>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card.Root surface="flat">
          <Card.Header title="Collections trend" />
          <Card.Body>
            <AreaChart
              label="Collected against expected, sample"
              series={[
                { id: "collected", label: "Collected", variant: "area" },
                { id: "expected", label: "Expected", variant: "line" },
              ]}
              points={TREND.map(([key, expected, collected]) => ({
                key,
                values: { expected, collected },
              }))}
              formatValue={formatCurrency}
              formatKey={(key) => formatBusinessDate(key, "day-month")}
              formatKeyLong={(key) => formatBusinessDate(key)}
            />
          </Card.Body>
        </Card.Root>
        <HealthCard.Root>
          <HealthCard.Header
            icon={<MapTrifold />}
            tone="positive"
            title="North"
            subtitle="4 lines"
            value={
              <Badge tone="positive" shape="pill">
                Tallied
              </Badge>
            }
          />
          <Meter
            value={1000}
            label="North collected of expected"
            valueText="100.0%"
            tone="positive"
          />
          <HealthCard.Detail>
            On expected · 4 of 4 lines tallied
          </HealthCard.Detail>
        </HealthCard.Root>
      </div>
      <Card.Root surface="flat">
        <Card.Header title="Needs attention" />
        <Card.Body>
          <ActivityList.Root aria-label="Needs attention, sample">
            <ActivityList.Item>
              <ActivityList.Icon tone="critical">
                <HandCoins />
              </ActivityList.Icon>
              <ActivityList.Body
                title="Priya’s cash for 15 Sep 2026 is disputed"
                meta="Market Road · −₹200.00 short"
              />
              <ActivityList.Aside>
                <Badge tone="critical" shape="pill">
                  Disputed
                </Badge>
              </ActivityList.Aside>
            </ActivityList.Item>
            <ActivityList.Item>
              <ActivityList.Icon tone="warning">
                <CalendarX />
              </ActivityList.Icon>
              <ActivityList.Body
                title="Bus Stand is not closed for 15 Sep 2026"
                meta="The Senior has not closed this day yet."
              />
            </ActivityList.Item>
          </ActivityList.Root>
        </Card.Body>
      </Card.Root>
    </div>
  );
}
