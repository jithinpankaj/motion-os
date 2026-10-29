# Fonts

Scene fonts are listed in `src/engine/fonts.ts`. Each library file uses a different one.

| Font | Source | Licence | How it's delivered | Used in |
|---|---|---|---|---|
| Geist, Inter, Fraunces, Instrument Serif, Geist Mono | Google Fonts | SIL OFL 1.1 | Bundled (`@fontsource`) | Editor defaults |
| Bricolage Grotesque | Google Fonts | SIL OFL 1.1 | Bundled | Living button |
| Bungee | Google Fonts | SIL OFL 1.1 | Bundled | Slot bird (the 7s) |
| Caveat | Google Fonts | SIL OFL 1.1 | Bundled | Mochi |
| Oi | Free Faces (hosted on Google Fonts) | SIL OFL 1.1 | Bundled | Bouncy headline |
| Barriecito | Free Faces (hosted on Google Fonts) | SIL OFL 1.1 | Bundled | Inchworm loader |
| Space Grotesk | Free Faces (hosted on Google Fonts) | SIL OFL 1.1 | Bundled | — |
| Satoshi | Fontshare (Indian Type Foundry) | ITF Free Font License | Loaded from Fontshare's CSS API at runtime | Task checkbox |
| Cabinet Grotesk | Fontshare | ITF Free Font License | Fontshare CSS API | Like burst |
| Clash Display | Fontshare | ITF Free Font License | Fontshare CSS API | Reward badge |
| Zodiak | Fontshare | ITF Free Font License | Fontshare CSS API | Day & night switch |

OFL fonts may be bundled and redistributed. Fontshare's free licence restricts redistributing the font files,
so they are **not** copied into this repository; the app fetches them from `api.fontshare.com` /
`cdn.fontshare.com` when a file uses them (an internet connection is needed for those four). Before shipping
the product commercially, confirm with ITF that the free licence covers use inside an interactive web app
and in exported videos — or swap those four for OFL fonts.
