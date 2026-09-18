# design/

Brand assets. The vector files here are the source; everything else is derived.

| File | What |
|---|---|
| `assets/logo.svg` | **Master** of the Jarvis logo (outline `#17121C`, face `#F2E6D4`, left eye product blue `#3786E6`, right eye coral `#E05552`). |
| `assets/logo-mono-dark.svg` | One-colour logo in ink, for light backgrounds. Derived. |
| `assets/logo-mono-light.svg` | One-colour logo in ivory, for dark backgrounds. Derived. |

Run `python3 scripts/logo-assets.py` after changing the master. It rewrites the
derived files — the two mono SVGs here and, in `frontend/public/`,
`logo.png`, `favicon-16x16.png`, `favicon-32x32.png`, `favicon.ico` and
`apple-touch-icon.png`. `--check` fails when any of them is stale. Do not edit
or resize the derived files by hand. The script needs Pillow
(`python3 -m pip install pillow`).

The rules for using the logo are in [docs/design-system.md](../docs/design-system.md).
