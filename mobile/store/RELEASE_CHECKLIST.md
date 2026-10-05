# Store Release Checklist

## Completed in source
- [x] Property Care 360 branding
- [x] Bundle/package ID set to uk.co.propertycare360.app
- [x] iPhone and Android Capacitor project configuration
- [x] Responsive customer portal bundled into native app
- [x] Supabase authentication and RLS-backed customer data
- [x] Stripe browser checkout for real-world services
- [x] Booking, properties, jobs, reports and billing views
- [x] Optional local appointment reminders
- [x] Branded 1024px store icon generation
- [x] In-app account deletion request
- [x] Public account deletion request page
- [x] Privacy policy URL
- [x] Support URL
- [x] Terms URL
- [x] Android/iOS compile validation workflow added to GitHub Actions
- [x] Store metadata and privacy/data-safety draft prepared
- [x] Apple Developer Program membership activated
- [x] App Store Connect access activated
- [x] iOS release workflows simplified to App Store Connect API-key automatic signing

## Requires owner developer-account access
- [ ] In App Store Connect, request App Store Connect API access if Apple has not already enabled it, then generate a Team API key with sufficient signing/provisioning permissions.
- [ ] Add APPLE_TEAM_ID, APP_STORE_CONNECT_KEY_ID, APP_STORE_CONNECT_ISSUER_ID and APP_STORE_CONNECT_PRIVATE_KEY_BASE64 as GitHub Actions secrets.
- [ ] Let the automatic-signing workflow register/use uk.co.propertycare360.app and create the required signing assets, or register the App ID manually if Apple requires it.
- [ ] Google Play Console: complete the organisation/business developer account and identity verification. Google requires a D-U-N-S number for organisation/business accounts.
- [ ] Configure Android Play App Signing / secure upload key
- [ ] Create signed Android AAB
- [ ] Create signed iOS archive / TestFlight build
- [ ] Capture screenshots from real Android and iPhone devices
- [ ] Create a non-personal store-review test account
- [ ] Complete Apple App Privacy questionnaire
- [ ] Complete Google Play Data Safety questionnaire
- [ ] Complete age/content ratings
- [ ] Upload screenshots, icon and listing text
- [ ] Run internal testing / TestFlight
- [ ] Complete any Google closed-testing requirement that applies to the developer account
- [ ] Submit both stores for review

## Production account / security items
- [ ] Set Monzo as the default GBP payout account in Stripe through Stripe's secure bank-account flow; keep the existing payout account until Monzo is confirmed active.
- [ ] Enable Supabase leaked-password protection in Auth password-security settings. This is a dashboard setting and is currently the only security advisor warning.

## Business/legal launch item
- [ ] Replace the geographic-address placeholder in the public membership terms with a confirmed business trading/correspondence address that the owner is comfortable publishing before launch.
