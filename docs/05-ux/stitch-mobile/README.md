# Stitch designs: mobile PWA, all roles

Screen designs for the whole product at phone width (390px), for Super Admin, Admin, Senior and Junior. The desktop console designs are in [../stitch/](../stitch/README.md).

- **Stitch project:** "Rasi Mobile, all roles" (`projects/12354143998208125224`), design system "Rasi Mobile" (`assets/16913547791040596325`).
- **Generated:** 19 Sep 2026 with Stitch (Gemini 3.8 Flash), all 43 screens at mobile width.
- **[DESIGN.md](DESIGN.md):** the mobile design system. It uses the same soft-teal tokens as `packages/ui/src/theme.css`, with a phone layout: a top app bar, a bottom tab bar for each role, bottom sheets instead of dialogs, and rows instead of tables.
- **[screens.json](screens.json):** shared shells (`base`, `console` plus a tab set per role, `junior`, `none`) and one prompt per screen. A screen is built from `base` + its shell + its tabs + its prompt, so any screen can be regenerated in the same style.
- **[manifest.json](manifest.json):** each screen's Stitch screen id and image file.

These designs are references, not the source of truth. Where a design and [screen-specs.md](../screen-specs.md) disagree, the spec wins. Sample data is invented. A screen that shows a sheet, an error or an empty state does so on purpose, to design that state.

## Adopted as the phone layout

The bottom tab bar with a "More" sheet is now the console's **phone layout**. Each device chooses it, and the installed app asks on its first launch ([ADR-0016](../../02-architecture/adr/0016-installable-app-and-per-device-layout.md), [navigation-ia.md](../navigation-ia.md#responsive-behaviour)). The frame is built. The page-by-page layouts in these images are the target for each screen, and their progress is tracked in the backlog.

One departure from [DESIGN.md](DESIGN.md): dialogs stay centred on a phone rather than becoming bottom sheets. Most dialogs ask for a reason or an amount, and a sheet pinned to the bottom is what the phone's keyboard covers. The "More" menu and the layout chooser are sheets, because they have nothing to type.

## Stitch added things the product does not have

Do not build these from the images:

- **Junior app chrome:** Stitch put an app bar with a back arrow and the line name above the status strip. The spec has only the status strip. It also added a clock or "SYNC READY" at the strip's right; the spec puts the bell there.
- **S-02:** quick-amount chips (₹100, ₹200, ₹500), "Daily Loan 1" labels, and an account status badge on each card.
- **S-01:** a "Collect" button and a "Tap to collect" link on rows. The whole row is the tap target.
- **S-07:** captions "Verified KYC", "3 lines on field", "Advance receipts", "Disbursed capital" and "Net earned", and a "Rasi Finance" brand line. Profit is shown in teal, but teal is the action colour only.
- **S-19:** "Needs approval" under handovers waiting (a handover is acknowledged, not approved), "In cash box", and a refresh button in the app bar. S-19 was also rendered on a wide canvas with the phone centred.

## Screens

| Role        | Screens                                                                                                                                                  |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| All         | S-30 sign in, US-003 change password                                                                                                                     |
| Super Admin | US-006 sign up, NAV-SA More, S-07 business overview, S-07b sector comparison, S-28 business settings                                                     |
| Admin       | NAV-AD More, S-20 today, S-08, S-09, S-10, S-04, S-04b, S-11, S-13, S-12, S-12b, S-14, S-14b, S-15, S-16, S-18, S-21, S-22, S-24, S-25, S-27, S-29, S-31 |
| Senior      | NAV-SR More, S-19 my line, S-17 collection detail with correction request, CASH, S-05 day close, S-22a line-wise report, OFFLINE-C                       |
| Junior      | S-01 route, S-01e holiday route, S-02 record, S-03 sync, S-06 hand over, S-21J notifications                                                             |

### Sign-in (all roles)

#### S-30 · sign in

![S-30 sign-in](screens/s-30-sign-in.png)

#### US-003 · change password

![US-003 change-password](screens/us-003-change-password.png)

### Super Admin

#### US-006 · sign up

![US-006 sign-up](screens/us-006-sign-up.png)

#### NAV-SA · more super admin

![NAV-SA more-super-admin](screens/nav-sa-more-super-admin.png)

#### S-07 · business overview

![S-07 business-overview](screens/s-07-business-overview.png)

#### S-07b · sector comparison

![S-07b sector-comparison](screens/s-07b-sector-comparison.png)

#### S-28 · business settings

![S-28 business-settings](screens/s-28-business-settings.png)

### Admin

#### NAV-AD · more admin

![NAV-AD more-admin](screens/nav-ad-more-admin.png)

#### S-20 · admin today

![S-20 admin-today](screens/s-20-admin-today.png)

#### S-08 · customer list

![S-08 customer-list](screens/s-08-customer-list.png)

#### S-09 · customer 360

![S-09 customer-360](screens/s-09-customer-360.png)

#### S-10 · new customer

![S-10 new-customer](screens/s-10-new-customer.png)

#### S-04 · new account

![S-04 new-account](screens/s-04-new-account.png)

#### S-04b · new account mid term

![S-04b new-account-mid-term](screens/s-04b-new-account-mid-term.png)

#### S-11 · account detail

![S-11 account-detail](screens/s-11-account-detail.png)

#### S-13 · sectors

![S-13 sectors](screens/s-13-sectors.png)

#### S-12 · lines

![S-12 lines](screens/s-12-lines.png)

#### S-12b · line detail

![S-12b line-detail](screens/s-12b-line-detail.png)

#### S-14 · team

![S-14 team](screens/s-14-team.png)

#### S-14b · add staff password

![S-14b add-staff-password](screens/s-14b-add-staff-password.png)

#### S-15 · staff detail assign

![S-15 staff-detail-assign](screens/s-15-staff-detail-assign.png)

#### S-16 · collections

![S-16 collections](screens/s-16-collections.png)

#### S-18 · pending approvals

![S-18 pending-approvals](screens/s-18-pending-approvals.png)

#### S-21 · notifications

![S-21 notifications](screens/s-21-notifications.png)

#### S-22 · reports index

![S-22 reports-index](screens/s-22-reports-index.png)

#### S-24 · report overdue

![S-24 report-overdue](screens/s-24-report-overdue.png)

#### S-25 · report discrepancy

![S-25 report-discrepancy](screens/s-25-report-discrepancy.png)

#### S-27 · holidays

![S-27 holidays](screens/s-27-holidays.png)

#### S-29 · audit log

![S-29 audit-log](screens/s-29-audit-log.png)

#### S-31 · refused attempts

![S-31 refused-attempts](screens/s-31-refused-attempts.png)

### Senior

#### NAV-SR · more senior

![NAV-SR more-senior](screens/nav-sr-more-senior.png)

#### S-19 · senior my line

![S-19 senior-my-line](screens/s-19-senior-my-line.png)

#### S-17 · collection detail

![S-17 collection-detail](screens/s-17-collection-detail.png)

#### CASH · cash senior

![CASH cash-senior](screens/cash-cash-senior.png)

#### S-05 · day close

![S-05 day-close](screens/s-05-day-close.png)

#### S-22a · report line wise

![S-22a report-line-wise](screens/s-22a-report-line-wise.png)

#### OFFLINE-C · console offline

![OFFLINE-C console-offline](screens/offline-c-console-offline.png)

### Junior field app

#### S-01 · junior route

![S-01 junior-route](screens/s-01-junior-route.png)

#### S-01e · junior route holiday

![S-01e junior-route-holiday](screens/s-01e-junior-route-holiday.png)

#### S-02 · junior record collection

![S-02 junior-record-collection](screens/s-02-junior-record-collection.png)

#### S-03 · junior sync

![S-03 junior-sync](screens/s-03-junior-sync.png)

#### S-06 · junior handover

![S-06 junior-handover](screens/s-06-junior-handover.png)

#### S-21J · junior notifications

![S-21J junior-notifications](screens/s-21j-junior-notifications.png)
