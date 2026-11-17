# LING desktop identity

The ZCode-backed LING build uses the existing fold-indigo LING icon, the desktop name LING, and the Chinese display name 灵创. The application menu, startup and sign-in surfaces, window title, and About dialog should use the LING identity. Provider names and upstream service and plugin identities retain their own branding.

The desktop product identity owns the bundle name and identifier. The preview build uses its own LING identifier and an isolated data directory so it can run alongside the earlier LING and upstream ZCode applications. Verify the built metadata and icon, then open the local desktop build and check that its startup and sign-in screens render.
