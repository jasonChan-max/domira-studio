# Shared cover design system — 2026-11-06

`public/design-tokens.css` extracts the current canonical cover palette, typography and radii into shared variables. The current cover, studio, Care and login pages load it before their component CSS. All 12 component stylesheets consume those variables.

- Background: `--domira-color-background` (`#f4f3ef`)
- Ink: `--domira-color-ink` (`#192422`)
- Primary action: `--domira-color-primary` (`#244a44`)
- Typeface: `--domira-font-sans` (Arial and Chinese sans-serif fallbacks)
- Controls: `--domira-radius-control` (`4px`)
- Cards: `--domira-radius-card` (`6px`)
- Circular data swatches: `--domira-radius-round` (`50%`)

The full original cover palette, including overlay opacity, is retained as named cover tokens. Component-specific UI colors are mapped to the shared neutral/green palette. Material preview colors and route overlays remain separate content tokens, preserving furniture style examples and data visualization meaning. Runtime 3D materials, user-selected furniture colors, room-type identifiers and exported drawings are design data rather than interface theme settings.

`tests/theme.test.mjs` verifies shared page loading, resolves all token references, and prevents component CSS from reintroducing literal colors, font families or radii. Existing layout, account, care, scanning, floorplan and backend behavior is preserved from canonical base `d7f3922`.

The development server now reads files before sending success headers so missing assets return 404 without crashing. `PORT` supports a separate local preview without displacing another running workspace.
