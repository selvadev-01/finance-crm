# Stitch designs — all screens

Screen designs generated in Google Stitch from [DESIGN.md](DESIGN.md), the soft teal design system that restates `packages/ui/src/theme.css`. They are design references, not the source of truth: where a design and [screen-specs.md](../screen-specs.md) or the built screen disagree, the spec wins.

- **Stitch project:** “Rasi — Daily Collections” (`projects/3059148314205483849`), design system “Rasi” (`assets/ea66973b2be54cfe9cd9a25490c81c02`).
- **Generated:** 17 Sep 2026 with Stitch (Gemini 3.8 Flash). Console screens are at desktop width, the Junior app at mobile width.
- **Mobile, all roles:** the phone-width set for every role is briefed separately in [../stitch-mobile/](../stitch-mobile/README.md).
- **Prompts:** [screens.json](screens.json) holds a shared shell per product plus one prompt per screen, so any screen can be regenerated in the same style.

Sample data in the designs is invented (names, shops, amounts). Screens that show a dialog or an error state do so on purpose, to design that state.

**Stitch added things the product does not have. Do not build them from these images:**

- **Extra navigation:** "Support" and "Settings" at the foot of the sidebar, and a "Collections Admin" subtitle under the brand. Settings and Reports appear only on the screens that ask for them (S-24, S-27, S-28).
- **Field app:** "GPS enabled", "Background sync every 5 minutes", "Direct Sunlight Mode", "Junior Verification Active", "Branch 01 · Route B", account-type chips ("Daily 100-Day", "Festival Seasonal"), and a phone link on S-02.
- **Wording that differs from the product:**

  | Screen | Stitch shows                                             | The product says                    |
  | ------ | -------------------------------------------------------- | ----------------------------------- |
  | S-04   | "Projected Margin" and a "Standard daily" chip           | "Profit", no chip                   |
  | S-07   | "Madurai" branch names and "Portfolio Discrepancy Watch" | Not in the product                  |
  | S-01   | "Part paid" under an amount                              | The route shows only the sync state |

Where a design and [screen-specs.md](../screen-specs.md) disagree, the spec wins.

## Sign-in

### S-30 · Sign in - Rasi Console

![S-30 sign-in](screens/s-30-sign-in.png)

### US-006 · Set up your business - Rasi

![US-006 sign-up](screens/us-006-sign-up.png)

### US-003 · Choose a new password - Rasi

![US-003 change-password](screens/us-003-change-password.png)

## Admin console

### S-07 · Business overview - Rasi Console

![S-07 business-overview](screens/s-07-business-overview.png)

### S-20 · Today - Rasi Console

![S-20 admin-dashboard](screens/s-20-admin-dashboard.png)

### S-19 · LN-07 · Market Road - Rasi Console

![S-19 senior-line-dashboard](screens/s-19-senior-line-dashboard.png)

### S-08 · Customers - Rasi Console

![S-08 customer-list](screens/s-08-customer-list.png)

### S-09 · Kumar Traders · CUS-00412 - Rasi Console

![S-09 customer-360](screens/s-09-customer-360.png)

### S-10 · New customer - Rasi Console

![S-10 new-customer](screens/s-10-new-customer.png)

### S-04 · New account - Rasi Console

![S-04 create-account](screens/s-04-create-account.png)

### S-04b · New mid-term account - Rasi Console

![S-04b create-account-mid-term](screens/s-04b-create-account-mid-term.png)

### S-11 · ACC-2026-0091 · Kumar Traders - Rasi Console

![S-11 account-detail](screens/s-11-account-detail.png)

### S-13 · Sectors - Rasi Console

![S-13 sectors](screens/s-13-sectors.png)

### S-12 · Lines - Rasi Console

![S-12 lines](screens/s-12-lines.png)

### S-12b · LN-07 · Market Road Staff - Rasi Console

![S-12b line-detail](screens/s-12b-line-detail.png)

### S-14 · Team - Rasi Console

![S-14 team](screens/s-14-team.png)

### S-15 · Priya S · Assign line - Rasi Console

![S-15 staff-detail-assign](screens/s-15-staff-detail-assign.png)

### S-16 · Collections - Rasi Console

![S-16 collections](screens/s-16-collections.png)

### S-17 · Anbu Tea Stall · ACC-2026-0112 - Collections - Rasi Console

![S-17 collection-detail](screens/s-17-collection-detail.png)

### S-18 · Pending approvals - Rasi Console

![S-18 pending-approvals](screens/s-18-pending-approvals.png)

### CASH · Cash - Rasi Console

![CASH cash](screens/cash-cash.png)

### S-05 · LN-07 · Market Road Day close - Rasi Console

![S-05 day-close](screens/s-05-day-close.png)

### S-21 · Notifications - Rasi Console

![S-21 notifications](screens/s-21-notifications.png)

### S-29 · Audit log - Rasi Console

![S-29 audit-log](screens/s-29-audit-log.png)

### S-24 · Overdue accounts - Rasi Console

![S-24 report-overdue](screens/s-24-report-overdue.png)

### S-27 · Holidays - Settings - Rasi Console

![S-27 holidays](screens/s-27-holidays.png)

### S-28 · Business settings - Rasi Console

![S-28 settings](screens/s-28-settings.png)

## Junior field app

### S-01 · Today's route · Rasi Junior

![S-01 junior-route](screens/s-01-junior-route.png)

### S-02 · Kumar Traders · Record collection - Rasi

![S-02 junior-record-collection](screens/s-02-junior-record-collection.png)

### S-03 · Sync · Rasi Junior

![S-03 junior-sync](screens/s-03-junior-sync.png)

### S-06 · Hand over cash · Rasi Junior

![S-06 junior-handover](screens/s-06-junior-handover.png)

### S-21J · Notifications · Rasi Junior

![S-21J junior-notifications](screens/s-21j-junior-notifications.png)
