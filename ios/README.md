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

## Signed upload from GitHub (no local Mac)

The manually triggered `Upload iOS to TestFlight` workflow uses Xcode automatic signing with an Apple team API key. It is never triggered by a source push and has not yet been run. Register `ltd.duomo.domira` and create its App Store Connect app record first. The Apple Team ID is entered as a workflow input. Xcode may create signing certificates/profiles in the specified Apple team; do not run until the owner confirms this identifier and team.

The account owner must create an App Store Connect **team API key** with permission to manage certificates/identifiers/profiles and upload builds, and save these GitHub Actions secrets personally:

- `ASC_KEY_ID`: Apple key ID.
- `ASC_ISSUER_ID`: Apple issuer ID.
- `ASC_PRIVATE_KEY`: full downloaded `.p8` PEM content, including BEGIN/END lines.

Never send the private key or Apple password to chat. The workflow writes the key into a restricted temporary directory on an ephemeral macOS runner, removes it on completion, archives/exports using automatic provisioning and uploads through Transporter. It does not submit App Review or invite testers. If Apple API roles or the team's automatic signing setup reject certificate creation, the workflow stops: resolve that permission with the account owner rather than bypass signing. Signed upload is unverified until the real account is configured.

After processing, open App Store Connect → Domira → TestFlight, supply beta review information and select internal testers. External testers require Apple's beta review. Complete agreements personally if Apple requests them. No Apple submission or invitation has yet occurred.

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
