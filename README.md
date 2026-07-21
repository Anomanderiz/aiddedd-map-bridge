# AideDD Map Bridge for Vercel

This is a narrowly scoped reverse proxy for `https://www.aidedd.org`. It preserves the atlas appearance while injecting a small Leaflet bridge that reports map centre/zoom to the Foundry module through `postMessage`.

## Deploy

1. Create a new Vercel project from this folder or upload it to a Git repository and import it into Vercel.
2. No environment variables are required. Optional: set `AIDEDD_ORIGIN=https://www.aidedd.org`.
3. Deploy.
4. Test this URL, replacing the domain with your deployment:

   `https://YOUR-BRIDGE.vercel.app/atlas/index.php?map=R&l=1`

5. Paste that complete URL into the Tile's **Bridged atlas URL** field in Foundry.

## Why the bridge is necessary

A direct `aidedd.org` iframe is cross-origin. Foundry may display it, but browser security prevents the parent page from reading the Leaflet centre and zoom. This relay serves the same page from a domain you control and injects an explicit `postMessage` interface.

## Caveats

- This is intended for private campaign use. AideDD remains the source and owner of its content.
- AideDD can change its HTML or mapping library, which may require the bridge script to be adjusted.
- The bridge fetches only from the fixed `AIDEDD_ORIGIN`; it is not an open arbitrary proxy.


## v1.0.1

- Replies immediately when Foundry requests the final map centre and zoom during Close & Share.
- More robustly discovers the Leaflet map even when the atlas creates it before the normal initialization hook catches it.
- Reapplies an incoming saved viewport after the atlas finishes its own startup positioning.
