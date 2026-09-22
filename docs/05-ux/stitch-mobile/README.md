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

## Junior field app: J screens

**The Junior's app was redesigned on 2026-09-21** as a native Android-style app, and the J screens below replace S-01, S-01e, S-02, S-03, S-06 and S-21J as its reference. They are in the same Stitch project, on their own design system "Rasi Field App — native" (`assets/565455906652034039`: the same tokens, IBM Plex, Material 3 anatomy). The user approved them the same day, and the field app was rebuilt to match ([navigation-ia](../navigation-ia.md#the-juniors-app-is-a-native-five-tab-app), [screen-specs](../screen-specs.md#s-01--todays-route-junior)).

| Screen | What it shows                                            | Stitch screen id                   |
| ------ | -------------------------------------------------------- | ---------------------------------- |
| J-00   | Sign in, with the "don't match" error                    | `cd0e980d442f44acb9ec4d881ee71677` |
| J-01   | Today's route: progress, search, filter, cards, snackbar | `528e88cb95d94b27bcafc34c22d22d5e` |
| J-01b  | Offline, sign-in expired, 7 not sent                     | `fea36aee8a0e44cda0496d08a9e7620d` |
| J-01c  | Holiday, Sunday, first-load and all-visited states       | `d60b8ffb6eda4e4d9a2bf84dc2269e9f` |
| J-02   | Record collection, one account                           | `c14e03293a64408a9af208df5621561b` |
| J-02c  | "Record no payment" bottom sheet                         | `033740420d5a4630807a5442a8735ea2` |
| J-02d  | Amount over the outstanding                              | `fbdbc98506dc4bd3899feb5f1fd14e0c` |
| J-03   | Collections tab: today's collections                     | `611c9d109e0a46a6ba1a34c7770fabce` |
| J-04   | Sync with every entry state                              | `6a829e39210e4eaba1b99c5abf5e56a2` |
| J-04b  | "Hand in and remove" bottom sheet                        | `22b76bc5bc1e4d56960aac0a9d6cf583` |
| J-04c  | Everything sent                                          | `78fab102309a4ff1abd4f9f9ef2323cd` |
| J-05   | Cash tab: count and hand over                            | `4e8e857575f543e38c9d0976d50922bd` |
| J-05b  | Waiting for acknowledgement, recent handovers            | `0284b9b480da4275af3a330617e96fc4` |
| J-06   | Ask for a correction                                     | `90f4fa499f024da7b96141def8eeeae7` |
| J-07   | Notifications with the push card                         | `a574549ea2644c2ebd9c653c4bd55fdc` |
| J-08   | Profile: this phone, password, blocked sign-out          | `06ca377a5e1e4a648fb1ed62d76975b0` |
| J-09   | Customers tab: the line as a portfolio (2026-09-22)      | `1079c3f39cec45cc997873693a7d835d` |
| J-10   | A customer's portfolio for the Junior (2026-09-22)       | `5098bf6cdfab4d918f15209b198a2e8c` |
| S-09p  | Customer 360 portfolio, Senior on a phone (2026-09-22)   | `8bf6750b8a9d4d79820be4a7a39c0c15` |
| S-09p  | Customer 360 portfolio, Admin on a computer (2026-09-22) | `7c69a2a5fc1b4b7d93f9e2c2a92a7929` |

All of them are built. J-00 is the shared sign-in and password layout on a phone, so every role sees it there. J-02b, two accounts on one customer, never generated (Stitch timed out twice); the built screen follows S-02's rule instead — one card per account, each with its own buttons. Several J screens were saved on a wide canvas with the phone centred.

**Not built from the J images**, because nothing in the data carries them: "Daily 100" chips and "Day 87 of 100" (J-02), handover codes, a "Recount" button and a docked collected-cash bar (J-05b), quick-amount chips (J-06), an "ID: LN-07" chip (J-08), a microphone in the search field (J-01). The portfolio set is also not built from its extras: "Pace status", "Daily #48/100", "Stop #14", "Daily 100 scheme", "Interest realized", a "Rasi Finance" brand and a "Collection Attention" callout. Stitch also coloured "Outstanding" red and showed "₹0" for a no-payment row; the build keeps red for status and says "No payment" in words.

## Stitch added things the product does not have

Do not build these from the images:

- **Junior app chrome (S screens):** superseded by the J screens above, which adopt the top app bar deliberately.
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
| Junior      | J-00…J-08 (above); superseded: S-01 route, S-01e holiday route, S-02 record, S-03 sync, S-06 hand over, S-21J notifications                              |

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
