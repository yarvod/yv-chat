# yv-chat brand sources

`yv-chat-symbol.svg` is the canonical icon mark. It intentionally has a transparent
canvas and no baked square/rounded platform shape. Its declared artwork bounds stay
inside the central maskable safe circle. `yv-chat-icon-master.png` remains the
original visual reference, while `yv-chat-launch-master.png` is the Apple launch
screen source created for `WP-041`.

Production derivatives live in `public/icons`, `public/apple-touch-icon.png`, and
`public/splash`. Run `npm run generate:pwa-icons` from `frontend/` to reproduce
standard transparent, full-bleed maskable and Apple icons from the SVG using the
pinned direct `sharp` dev dependency. Splash images remain based on the launch
master; do not repeatedly resize a smaller derivative.

Prompt direction: a quiet midnight-indigo private-messenger identity made from a
few intertwined blue, violet, and muted-pink gradient lines, centered, minimal,
readable at small sizes, with calm full-bleed background edges and no lettering.
