# Domira iOS beta 1

Native SwiftUI/WKWebView app targeting iOS 17+, iPhone and iPad. The live studio, AI layout, furniture library, quotation, floor-plan upload and render services remain on the existing Cloudflare origins. Requires Internet; Safari projects are NOT automatically transferred into the app. Export project JSON in Safari and import in the app to migrate. Back up projects before deleting the app.

## Native integration

- Existing website `domiraRoomPlan` bridge starts native Apple RoomPlan on LiDAR-capable devices. Returns the existing `domira:roomplan` event with matching requestId and `domira.roomplan.v1` walls, column-major transforms and metres. The website validates data, shows dimensions for confirmation, then creates the editable model. This is single-room capture; do not claim multi-room merging or native AR furniture placement.
- Unsupported hardware returns a clear error and keeps manual/camera measurement available. WebXR support is not assumed in WKWebView.
- Blob downloads up to 20 MB open the iOS share sheet for Files/AirDrop. No photo library permission required. Temporary export files are removed after sharing.
- Native bridge accepts main-frame messages only from the HTTPS production host. External HTTPS/mail links leave the trusted web view; secrets are never embedded. Website media permissions still prompt; camera use must be tested on device.

## Build without a Mac

The GitHub `Build iOS beta` workflow uses a hosted macOS runner to generate the project with XcodeGen and compile an unsigned iPhone/iPad app. This verifies compilation only; it does not produce an installable signed IPA or publish to TestFlight.

Local Mac alternative: install Xcode and XcodeGen, run `cd ios && xcodegen generate`, open Domira.xcodeproj, choose your real developer team and a registered Bundle ID, then Archive and Distribute via App Store Connect.

## TestFlight publication prerequisites

Proposed Bundle ID `ltd.duomo.domira` must be registered by the account owner (not yet confirmed). Supply the non-secret Apple Team ID and create an App Store Connect app record with this identifier. Paid Apple Developer membership is required.

For signed cloud builds, the account owner must create/export an Apple Distribution certificate with private key (.p12), its password and an App Store provisioning profile matching this app; create an App Store Connect API key with appropriate access. Save these only as GitHub Actions encrypted secrets, never in chat or Git: `IOS_DISTRIBUTION_P12_BASE64`, `IOS_DISTRIBUTION_PASSWORD`, `IOS_PROVISION_PROFILE_BASE64`, `ASC_API_KEY_P8_BASE64`, `ASC_KEY_ID`, `ASC_ISSUER_ID`. Signed upload workflow is the next step once the identifier/team and credential route are confirmed; this repository currently only runs unsigned builds. No testers have been invited and no Apple submission has been made.

An owner without access to certificate creation tools can use Apple's Xcode Cloud onboarding with a trusted Mac session, or arrange a secure Mac session for signing setup. GitHub macOS compilation does not bypass Apple signing requirements. Do not send Apple account passwords or private keys to a developer/chat.

## Device acceptance before external beta

1. Install signed build on LiDAR and non-LiDAR iPhones; deny/regrant camera permission and verify cancellation never leaves the scan button locked.
2. Scan >=3 walls, finish, check returned metres against known dimensions, confirm/create room, run AI layout, edit and save; cancel and repeat scans.
3. On a non-LiDAR iPhone, verify manual measurement and camera fallback. Check iPad landscape and file picker.
4. Import a real floor plan, confirm scale, inspect whole-home preview. Compare quotation totals in HKD.
5. Export JSON/PNG/OBJ through share sheet, import JSON in Safari, verify positions and dimensions. Test >20 MB rejection, no-network/retry and persistent local saves.
6. Test model/render errors and access token entry without exposing secrets. App requests do not relax the backend access rules.

## App Store readiness

Before submission: provide real iPhone/iPad screenshots, support/privacy URLs and a published privacy policy reflecting Cloudflare/AI image and floorplan processing; complete App Privacy labels, age rating, beta review contact and reviewer access instructions. Native-only privacy manifest does not cover backend data declarations. Check third-party 3D/model licensing and any paid digital rendering purchase flow. Apple approval is not guaranteed; website-only wrappers can fail guideline 4.2. Native RoomPlan and export must be demonstrated on actual devices. Camera scans are not certified architectural surveys.

References: https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds ; https://developer.apple.com/testflight/ ; https://developer.apple.com/app-store/review/guidelines/#minimum-functionality
