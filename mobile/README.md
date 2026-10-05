# Property Care 360 mobile

Android and iPhone customer app source for Adam Glover Plumbing & Heating. App identifier: `uk.co.propertycare360.app`. This project targets both the Apple App Store and Google Play; native signing and store submission still require the owner's developer accounts.

The customer portal is bundled into the app from `../public/app/index.html`; it connects to the same Supabase account and RLS-protected data. Stripe checkout, invoices and signed report URLs open in the native browser. Sign-up confirmation returns to the website; customers return to the app and sign in with their confirmed credentials. Website changes require a fresh app build and store update.

Optional local notifications remind customers about confirmed, calendar-synced appointments 24 hours and one hour ahead. Pending requests never generate reminders. Notifications are refreshed on data reload/app resume and cleared on logout. They omit addresses and personal information. Changes made while the app stays closed do not update already scheduled notifications until it next opens. No remote push service is configured.

## Generate native projects

Use Node 24, Android Studio 2025.2.1+ with SDK 36/JDK 21, or a Mac with a Capacitor 8 compatible Xcode installation. From this folder:

```
npm ci
npm test
npm run build
npx cap add android
npx cap add ios
node scripts/native-assets.mjs
npx cap sync
```

Only run `cap add` once for each platform. Open using `npx cap open android` or `npx cap open ios`. Commit native project customizations when signing/deep links or other settings are added. The generated native directories are intentionally excluded from this initial source commit, so the workflow above reproduces them. Do not put signing keys in GitHub.

## Before app-store submission

- Enrol the owner in Apple Developer and Google Play Console; verify account identity and business information. Confirm the bundle ID before registering it.
- Supply a public geographic business address for the terms; the website currently contains a launch placeholder.
- Account deletion is implemented in-app and at https://propertycare360.co.uk/delete-account/. Before production submission, test the full request path with a dedicated review/test account and confirm the operating process for active memberships, outstanding charges and legally retained records.
- Verify email confirmation redirect allowlists in Supabase; test signup, logout, login, separate-customer access and password recovery on real phones.
- Complete checkout and renewal testing using an isolated Stripe test environment. Never use the live payment links for automated charge tests.
- Test cancellation, rescheduling, reminders with denied permission, background app resume, report opening, loss of connectivity, multiple properties and accessibility on Android and iPhone.
- Verify branded adaptive icons and launch presentation on real phones. Capture real device screenshots and finish age/content rating, App Privacy and Google Data Safety disclosures. Draft disclosure notes are in mobile/store/DATA_DISCLOSURES.md. Data includes contact details, property addresses, account identifiers, bookings, reports and billing metadata. Stripe handles card data.
- Provide a working review account with non-personal demonstration properties and reports; no real credentials are committed here.
- Create signed Android AAB and iOS archive under the owner’s developer accounts; submit to internal testing/TestFlight before review. Newly created personal Google Play accounts may require a closed test with 12 testers for 14 consecutive days before production access.

Store description draft: Manage your Property Care 360 membership from your phone. Keep your properties together, request plumbing and heating visits, book maintenance, and view your reports and billing. Optional reminders help you remember confirmed appointments. Gas, LPG and oil-heated properties are supported. The app is free to download; service memberships and chargeable materials are paid separately. Membership is a service agreement, not insurance.

Support: adamglover561@gmail.com. Privacy: https://propertycare360.co.uk/privacy/. Terms: https://propertycare360.co.uk/terms/. App-store approval is not guaranteed; Apple assesses utility beyond a repackaged website.

Source-level validation is automated in .github/workflows/mobile-ci.yml for Android and iOS. Signing, store upload and real-device testing still require the owner's Apple Developer and Google Play Console accounts.

Official references: https://capacitorjs.com/docs/getting-started/environment-setup ; https://developer.apple.com/app-store/review/guidelines/ ; https://support.google.com/googleplay/android-developer/answer/14151465


Store-release drafts are in `mobile/store/`: listing metadata, privacy/data-safety notes and a release checklist.
