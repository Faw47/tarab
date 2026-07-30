## TARAB Design Language Spec (V1.1)

**Purpose:** single source of truth for TARAB visual and interaction behavior across desktop surfaces.

---

## Core vibe

- Glass intensity: medium-to-subtle, clearly visible, never noisy.
- Brightness: elevated surfaces over dark base backgrounds.
- Shape: soft squircle language for major surfaces.
- Motion: short, controlled, responsive.
- Consistency: controls should feel behaviorally identical across layouts.

---

## 1) Spacing system (4px grid)

| Token | px |
| ----: | -: |
|    S1 |  4 |
|    S2 |  8 |
|    S3 | 12 |
|    S4 | 16 |
|    S5 | 20 |
|    S6 | 24 |
|    S8 | 32 |
|   S10 | 40 |
|   S12 | 48 |
|   S16 | 64 |

View padding defaults:

- Standard views: X = 24px, Top = 32px, Bottom = 40px
- Dense lists: row padding Y = 12px, X = 16px
- Cards: 16px (compact), 24px (normal), 32px (hero)

Library album composition:

- The standard Library album grid starts with one featured album spanning two columns, followed by regular album cards in normal reading order.
- Keep persistent album and artist labels beneath regular artwork; metadata must not depend on hover.
- The featured card uses a split artwork/details composition and should remain optically aligned to the height of its neighboring cards.
- Large collections may move albums after the initial showcase into a virtualized continuation, but the featured-first hierarchy must remain intact.

---

## 2) Radius system

|  Token |   px | Usage                           |
| -----: | ---: | ------------------------------- |
|     R1 |    8 | small chips, tiny panels        |
|     R2 |   12 | cards, inputs (default)         |
|     R3 |   16 | primary cards, modals (default) |
|     R4 |   24 | hero containers, big overlays   |
| RRound | 9999 | pills, circular icon buttons    |

---

## 3) Typography scale

| Role          | Size | Weight     | Line height |
| ------------- | ---- | ---------- | ----------- |
| Caption       | 12px | 400 to 500 | 16px        |
| Body          | 14px | 400 to 500 | 20px        |
| Body strong   | 14px | 600        | 20px        |
| Subhead       | 16px | 600        | 22px        |
| Section title | 18px | 600        | 24px        |
| Page title    | 30px | 700        | 34px        |
| Hero title    | 36px | 700        | 40px        |

Contrast/readability rules:

- Section labels over glass should not drop below `text-white/40`.
- Decorative metadata can be dimmer, but actionable text should remain clearly legible.
- Supporting text must be at least 12 px. Dense interactive labels should use 13 to 14 px when
  the available surface permits it.

---

## 4) Icon sizing

| Token | px | Typical use                 |
| ----: | -: | --------------------------- |
|    I1 | 12 | tiny indicators             |
|    I2 | 16 | default button icons        |
|    I3 | 20 | nav icons                   |
|    I4 | 24 | primary actions             |
|    I5 | 32 | compact empty states        |
|    I6 | 48 | large empty states          |

---

## 5) Glass surfaces

All glass surfaces use:

- Backdrop blur: 18px to 26px
- Light tint at low alpha
- 1px low-alpha white border
- Subtle top highlight gradient

| Intensity | Tint RGBA              | Border RGBA            | Blur |
| --------: | ---------------------- | ---------------------- | ---- |
|    Subtle | rgba(255,255,255,0.06) | rgba(255,255,255,0.10) | 18px |
|    Medium | rgba(255,255,255,0.08) | rgba(255,255,255,0.12) | 22px |
|    Strong | rgba(255,255,255,0.10) | rgba(255,255,255,0.14) | 26px |

---

## 6) Color behavior

- Base background remains dark and soft.
- Accent colors may be derived from media/cover art.
- Accent-as-foreground usage must pass a luminance guard.

Dynamic accent foreground rule:

- When using extracted accent (`albumInk`) as foreground, derive readable text/icon color from luminance (`inkTextColor`) and use that for foreground glyphs.
- Keep accent color itself for backgrounds, glows, and button fills.

Opacity ranges:

- Surface tint: 0.06 to 0.10
- Hover tint add: +0.03
- Divider lines: 0.08 to 0.12
- Disabled content: use ~0.50 opacity on glass surfaces (do not fade to near-invisible)

---

## 7) Interaction states

Buttons/icon buttons:

- Hover: brighten tint by ~+0.03
- Active: scale to 0.98
- Focus ring: 2px (alpha ~0.35)

Cards:

- Hover: translateY -2px
- Active: translateY 0, scale 0.99

Selection:

- Brighter surface tint (+0.03)
- Border alpha bump (+0.04)
- Optional inner glow (~0.10)

---

## 8) Motion system

Durations:

| Token |  ms | Use                           |
| ----: | --: | ----------------------------- |
|    D1 | 120 | micro feedback                |
|    D2 | 180 | button press / small shifts   |
|    D3 | 240 | card hover / small panels     |
|    D4 | 320 | overlays / major transitions  |

Easing:

- Standard: `cubic-bezier(0.2, 0.8, 0.2, 1)`
- Springy: `cubic-bezier(0.16, 1, 0.3, 1)` for short entrance effects

Desktop overlay alignment:

- Sticky header backdrop + content transitions should align at 200ms.
- If staged, backdrop begins first (e.g. 75ms lead) while preserving consistent easing.

---

## 9) Overlays and modals

Overlay background:

- Scrim: `rgba(0,0,0,0.35)`
- Scrim blur: 8px to 12px

Modal container:

- Glass intensity: Medium
- Radius: 16px (default), 24px for larger modals
- Padding: 24px

---

## 10) Desktop-native polish patterns

Mini window:

- Always-on-top compact surface
- Controlled by main window state
- Can request and receive playback snapshot immediately on open

Selection toolbar entrance:

- Preferred motion: short vertical rise with fade using the 180 ms standard token.

Motion tokens:

- Fast feedback: 120 ms
- Standard controls: 180 ms
- Emphasized surface changes: 240 ms
- Use `cubic-bezier(0.2, 0, 0, 1)` for standard UI transitions.
- The operating-system Reduce Motion preference or Tarab Reduced Effects disables decorative motion.
- Do not stagger routine card entry. Animate only the surface or result state that changed.
- Declare each transitioned property. Do not use `transition-all`.

Supporting text:

- Use 12 px as the minimum size.
- Use 13–14 px for dense interactive labels.

Back/Sticky choreography:

- Shared easing curve (`ease-in-out`) for overlapping visibility transitions

---

## 11) Cover art treatment

- Hero art should scale responsively across phone/desktop.
- If art URL is pending, render shimmer placeholder.
- Use the shared cover-art resolver in every surface.
- Show the icon fallback only after native resolution confirms that the track has no art.
- Cache, permission, and protocol failures are repair states, not no-art states.
- Optional blur diffusion layer is disabled when reduced effects are enabled.

Full-player seek:

- Mount the shared seek bar on the top edge of the cover card.
- Keep the visible rail at 2 px and the pointer target at least 20 px.
- Reveal the rail, knob, and time tooltip on hover, focus, or drag.
- Clamp the dot, knob, and tooltip within the card corners.

Playback recovery:

- Keep playback failures visible until the listener chooses a recovery action.
- Offer Retry, Skip, Reveal in Finder, and Remove from Queue.
- Do not present a decode failure as normal track completion.

---

## 12) Loading and empty states

Loading:

- Skeleton shimmer for content
- Spinner for actions

Empty states:

- Icon (32px or 48px)
- Title (18px, 600)
- Body (14px)
- Optional CTA

---

```text
Before making UI/styling decisions in TARAB, follow this spec’s numeric scales and behavior rules.
If existing UI conflicts with these standards, align visuals while preserving product behavior.
```
