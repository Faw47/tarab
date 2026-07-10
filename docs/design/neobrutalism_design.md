# Neo Brutalism Design Language
## Version 3.0 — Comprehensive Reference

---

## Purpose

This document translates a specific application's visual system into a fully reusable design language applicable to any digital product. The source aesthetic is **neo-brutalist / editorial**: bold outlines, flat color planes, tactile press states, visible structure, loud labels, playful utility, and a deliberate system of physical metaphors that make the screen feel like a desk covered in printed objects.

This guide is intentionally exhaustive. Every rule, token, component, pattern, and anti-pattern is documented with enough specificity that a designer or engineer who has never seen the source application can implement the system correctly from scratch.

**Applicable product categories:**
- Music players, media browsers, creative tools
- Habit trackers, journaling apps, personal dashboards
- Social apps, friend-activity platforms
- Productivity tools, internal dashboards
- Mobile apps, desktop apps, web apps, landing pages

---

## Table of Contents

1. Core Aesthetic Summary
2. Foundational Principles
3. Signature Visual Traits
4. Physical Metaphor Components
5. Component Specifications
6. Layout Patterns
7. Navigation Architecture
8. Color System
9. Typography System
10. Spacing and Layout Rhythm
11. Motion and Interaction
12. Form Architecture
13. Data Visualization
14. State Patterns
15. Implementation Tokens
16. Reusable Styling Recipes
17. Anti-Patterns
18. Design QA Checklist
19. One-Sentence Design Direction

---

## 1. Core Aesthetic Summary

### Short definition

This design language is a **high-contrast, tactile, flat-layered, utility-first visual system** that makes interfaces feel physically constructed rather than optically polished. Every element is a stamped object. The screen is a surface. The user is manipulating physical things.

### What makes it distinctive

1. **Hard outlines** make every object feel intentional and complete.
2. **Flat fills** keep surfaces immediately readable without visual noise.
3. **Hard-offset shadows with zero blur** create depth that reads as physical thickness, not atmospheric diffusion.
4. **Mechanical press behavior** - elements translate on press and their shadows disappear, as if physically depressing a key.
5. **Uppercase utility labels** create an interface that reads like signage and printed forms.
6. **Dot matrix ground layer** establishes a tactile surface everything rests on.
7. **Precisely scoped accent colors** communicate state, not variety.
8. **Physical metaphor components** - tape, polaroids, legal pads, ruler tracks, mechanical toggles - borrow the trust and legibility of real-world objects.
9. **Visible structure** - frames, title strips, section rules, badge prefixes - expose the architecture rather than hiding it.
10. **Full-bleed semantic fills** on cards communicate state at a glance without any additional label.

### Emotional tone

Use this language when the product should feel:
- Honest, direct, zero-pretense
- Playful but structured
- Crafted and deliberate
- Energetic and editorial
- Slightly rebellious against corporate polish
- Bold rather than elegant
- Tactile rather than ethereal

### When to avoid it

- Ultra-luxury or premium fashion contexts
- Invisible/minimal interfaces meant to disappear
- Meditative, calm, or wellness-focused products
- Medical or clinical contexts requiring sterile aesthetics
- Highly formal or conservative institutional products
- Cinematic, glassmorphic, or futuristic visual directions

---

## 2. Foundational Principles

### 2.1 Constructed, not dissolved

The interface must look **assembled from distinct parts**: frames, title strips, content zones, action bars, badge prefixes, and separators. Nothing should bleed invisibly into anything else. Grouping is achieved through visible containment, not proximity alone.

**Design implications:**
- Prefer 2px black borders over spacing-only grouping.
- Every section needs an explicit header - ambiguous whitespace groups are not acceptable.
- Let UI components look like physical objects with edges.
- When two things belong together, frame them together. When they are separate, separate them with a visible rule or gap.

### 2.2 Contrast over subtlety

Visual hierarchy must be immediately readable without any training or familiarity. If a user needs to look twice to find the primary action or identify the current state, the design has failed.

Hierarchy is established through:
- Scale - dominant elements are significantly larger
- Weight - bold vs regular, not medium vs regular
- Hard outline thickness - 2px vs 1px makes a meaningful difference
- Placement - overflowing CTAs break the plane
- Full-bleed accent fills - active = colored background
- Hard shadows - the element with the largest shadow is the most important

**Absolutely prohibited as hierarchy tools:**
- Faint gradients
- Low-contrast `#999` vs `#aaa` dividers
- `backdrop-filter` blur
- `filter: blur()` on surfaces
- Soft drop shadows with blur radius
- Opacity reductions as the sole state change signal

### 2.3 Interaction must feel physical

Every pressable element in this system should behave like a physical button being depressed. Not "highlighted." Not "activated." **Pressed**.

**The physical press contract:**
1. At rest: element sits with full shadow, full opacity, full border weight.
2. On press: element translates `translate(4px, 4px)`, shadow becomes `none`. The element appears to sink into the surface.
3. On release: translate returns to `(0, 0)`, shadow restores.
4. Duration: 80-120ms. No easing that overshoots. No bounce.

This rule applies to every clickable surface: buttons, cards, tabs, toggles, chips, nav items. If it can be clicked, it must press.

### 2.4 The surface is the foundation

The background is not empty space behind the interface. It is a physical surface - a desk, a bulletin board, a sheet of graph paper - that every object rests on top of.

**Design implications:**
- The dot matrix ground layer is not optional decoration. It is the foundational surface that gives the hard-shadow system its meaning.
- Without the dot grid, hard-shadow cards float on nothing. With it, they sit.
- Objects that are physically attached to the surface (tape, stickers applied to cards) must use physically accurate rendering: translucency, material-appropriate opacity, thin soft shadows rather than hard offset shadows.
- Objects that sit on the surface (cards, buttons, panels) use the hard offset shadow.

### 2.5 Physical metaphors require physical accuracy

When a UI element references a physical object (tape, polaroid photo, legal pad, mechanical toggle, receipt printout, ruler), that reference must be accurate enough to be recognizable. A flat colored rectangle is not tape. A grid-perfect un-rotated card is not a photo.

**The accuracy test:** show the component to someone who hasn't seen the app. Do they immediately recognize the physical object being referenced without being told? If no, the metaphor has failed.

**Accuracy requirements:**
- Tape: translucent, warm amber tint, no hard border, faint inset sheen, soft thin shadow
- Polaroid: warm-white surface (not pure white), fat bottom border, slight rotation, tape clip on top
- Legal pad: yellow surface, repeating blue horizontal lines, single red vertical margin line
- Mechanical toggle: equal halves, high-contrast on/off fill difference, text inside each half
- Receipt: monospaced font, label-left value-right strict alignment, single-column vertical stack

### 2.6 Language sounds labeled

The copy system is as important as the visual system. This aesthetic pairs with language that sounds like signage, form labels, packaging instructions, and official stamps.

**Good copy patterns:**
- `SAVE ENTRY` not "Submit"
- `ADD PHOTO` not "Upload Image"
- `NO DATA YET` not "Nothing to show here"
- `TRY AGAIN` not "Retry"
- `NUDGE (5 LEFT)` - explicit, quantified, direct
- `HARDWARE DIRECT STATE` - technical label style
- `CONSOLE STANDBY` - system-status style

**Avoid:**
- Inspirational placeholder text ("Share your story...")
- Soft wellness microcopy ("Take a moment to reflect...")
- Vague status labels ("Something went wrong")
- Marketing-speak in UI labels

### 2.7 Color is semantic, not decorative

This system uses a very small accent palette. Each color has exactly one job. Using a color for its aesthetic appearance rather than its semantic meaning corrupts the system.

**The semantic color contract:**
- Yellow (`#F5C518`): primary CTA, active navigation fill, primary action shadow. Nowhere else.
- Lime green (`#7CC61F`): currently playing/active content state. Nowhere else.
- Red (`#E53935`): destructive and danger states only. Nowhere else.
- Black (`#000000`): universal ink - borders, shadows, primary text, section rules.

If a third accent color feels necessary, the solution is a layout revision, not a palette expansion.

### 2.8 Full-bleed fills communicate state

When a container's entire background changes color, it is communicating a state change that the user reads before they read any text. This is the fastest and most unambiguous communication channel available.

**Full-bleed fill semantics:**
- Lime green card fill: this item is currently playing / active / connected
- Yellow element fill: this is the primary action or selected state
- Gray/muted fill: this is inactive, disabled, or empty

The full-bleed fill must never be used merely for visual variety. Its rarity is its signal strength. If three cards in a grid all had lime green backgrounds, none of them would communicate "playing."

---

## 3. Signature Visual Traits

### 3.1 The Hard Shadow System

The most important single visual rule. Every interactive element uses this shadow formula:

**Default:** `box-shadow: 4px 4px 0px 0px #000000`

The shadow connects flush to the border. Zero blur. Zero spread. The element reads as a physical object with real thickness sitting on a surface, not a card floating above a background.

**Shadow variant table:**

| Context | Shadow value | When to use |
|---|---|---|
| Default card, button, panel | `4px 4px 0px 0px #000000` | All standard interactive elements |
| Primary CTA (the single most important action per view) | `4px 4px 0px 0px #F5C518` | One element per view maximum |
| Destructive action buttons | `4px 4px 0px 0px #E53935` | Danger zone and delete actions only |
| Nested button inside a card | `2px 2px 0px 0px #000000` | Buttons layered inside card containers |
| Hero panel or elevated modal | `6px 6px 0px 0px #000000` | Full-screen overlays, modal containers |
| Polaroid physical card | `3px 3px 0px 0px #1a1a1a` | Physical-metaphor cards with tape |
| Tape clip | `0 1px 2px rgba(0,0,0,0.12)` | Tape only - soft thin shadow, not hard offset |
| Tab bar container | `4px 4px 0px 0px #000000` | Entire tab group, not individual tabs |

**On press:** `transform: translate(4px, 4px); box-shadow: none;`
**On release:** restore both, 80-120ms ease-out.

**Absolutely prohibited:**
- Any `box-shadow` with a blur value greater than 0
- `backdrop-filter: blur()`
- `filter: blur()` on any surface
- `drop-shadow()` filter with blur
- Multiple layered soft shadows (the "material design" shadow stack)
- `box-shadow: 0 4px 12px rgba(0,0,0,0.15)` - this is the anti-shadow

### 3.2 Universal Border Weight

The system has one border weight for interactive elements: **2px solid #000000**.

Not 1px. Not 1.5px. Not `rgba(0,0,0,0.3)`. Not `#333333`. Two pixels, full opaque black.

**Exceptions with justification:**
- Polaroid card borders: `1.5px solid #1a1a1a` - physical photos have a slightly softer edge than stamped objects
- Tape clip borders: `1px solid rgba(180,155,80,0.35)` - tape has no printed edge, only a material edge
- Dashed dropzone borders: `2px dashed #000000` - same weight, different style to signal emptiness
- Data table hairlines: `1px solid #E5E5E5` - internal table dividers at data density

**What 2px black borders accomplish:**
- Creates the "stamped" or "printed" quality that makes everything feel deliberate
- Makes every element legible against any background including the dot matrix
- Ensures consistency - the eye reads the entire interface as one coherent material

### 3.3 Dot Matrix Ground Layer

The application canvas is a repeating dot grid, not a flat color. The dots establish the surface. Without them, hard-shadow objects float. With them, they rest.

```css
/* Light mode - primary surface */
.canvas-root {
  background-color: #e9e9e9;
  background-image: radial-gradient(circle, #b0b0b0 1px, transparent 1px);
  background-size: 18px 18px;
}

/* Dark mode */
.canvas-root.dark {
  background-color: #1a1a1a;
  background-image: radial-gradient(circle, rgba(255,255,255,0.08) 1px, transparent 1px);
  background-size: 18px 18px;
}
```

**Technical notes:**
- The dot size is 1px. Increasing it to 2px makes the grid aggressive and competes with content.
- 18px spacing is the correct density. 12px is too tight (grid becomes a texture). 24px is too loose (grid disappears at normal viewing distance).
- The dot color at `#b0b0b0` on `#e9e9e9` base creates a subtle but visible grid without competing with bordered cards.
- On dark mode, `rgba(255,255,255,0.08)` creates dots that are barely visible - just enough to establish surface, never enough to compete.

### 3.4 Color Semantics

Two accent colors. One destructive color. One ink. That is the entire system.

| Color | Hex | Exclusive role | Where it must NOT appear |
|---|---|---|---|
| Yellow | `#F5C518` | Active nav fill, primary CTA shadow | Track fills, generic highlights, decoration |
| Lime green | `#7CC61F` | Active/playing content, seek fill, volume fill | Navigation, CTA shadows, emphasis |
| Red | `#E53935` | Destructive buttons, danger labels, seek amber-end | General use, any non-destructive context |
| Black | `#000000` | All borders, all hard shadows, primary text | None - this is universal ink |

The lime green appears exactly where it needs to: when a track is playing, the card turns green. When the seek bar fills, it fills green. When a volume segment is active, it fills green. That single color now means "this is the thing that is happening right now" across the entire app, with zero ambiguity.

**Implementation tokens:** use `--signal-active` for yellow active/navigation states, `--signal-play` for lime playing/progress/volume states, and `--signal-danger` for destructive red. Components must consume these variables instead of embedding the corresponding hex values. Theme-specific hover shades may remain separate only when they represent a real interaction state rather than the base semantic color.


### 3.5 Active State Logic

Active states are fill-based. Never outline-based.

**The rule:** when an element is selected, active, current, or focused, its background fills with a solid color. It does not get a thicker border. It does not change text color alone. It does not get an underline.

- **Active navigation tab:** `background: #F5C518; border: 2px solid #000;` square fill behind the icon
- **Active filter pill:** `background: #F5C518; border: 2px solid #000;` - same yellow fill
- **Active/playing card:** `background: #7CC61F;` - full card background turns lime green
- **Active playlist row:** `background: #7CC61F; border-left: 4px solid #000;`
- **Focused input:** `background: #F5C518;` - entire field background turns yellow

**Why this works:** a filled background communicates "this area is active" at peripheral vision before the user reads any text. It requires zero interpretation. A thicker border or color change requires the user to look directly at the element and recognize the difference.

### 3.6 The Four Typography Levels

Exactly four levels. Zero intermediate sizes. The gap between levels must be large enough to read instantly.

| Level | Name | Spec | Exclusive use |
|---|---|---|---|
| 1 | Screen title | `clamp(40px, 8vw, 64px) / weight 800 / uppercase / tracking -0.02em` | View titles, hero labels only |
| 2 | Section header | `16px / weight 700 / uppercase / tracking 0.06em` | Panel headers, group names |
| 3 | Field label | `11px / weight 600 / uppercase / tracking 0.12em / color #888888` | Tag pills, field annotations, metadata sub-labels |
| 4 | Data value | `28px / weight 800 / normal case / tracking -0.01em` | Track titles, large numbers, dominant content |

**Body text** (non-hierarchical reading content): `16px / weight 400 / sentence case`
**Mono metadata** (timestamps, codes, receipt values): `12-14px / weight 600 / monospace / uppercase`

The Level 3 label register is the most frequently missed. It is the small, wide-tracked uppercase text that appears above data values, beneath measurements, and inside tag pills. Its width (`0.12em` tracking) is what makes it read as a label rather than small text. Without it, the interface feels data-light even when it has plenty of data.

### 3.7 Section Header Prefix Pattern

Every section header in the system follows one construction:

```
■ [emoji] SECTION NAME
────────────────────────────────────────
```

- The `■` is either a Unicode black square `■` or a 10×10px `background: #000` inline block
- A single space
- A semantic emoji that visually categorizes the section
- A space
- The section name in Level 2 typography
- Below: a full-width `border-bottom: 2px solid #000` rule

This construction appears in every section header across every view. It provides instant orientation and makes every section feel explicitly named rather than implicitly grouped.

**Assignment by domain:**

| Section | Header |
|---|---|
| Recently played | `■ 🕐 RECENTLY PLAYED` |
| Albums | `■ 💿 ALBUMS` |
| Artists | `■ 🎤 ARTISTS` |
| Queue | `■ 📋 QUEUE` |
| Now playing | `■ ▶ NOW PLAYING` |
| Vitals / health data | `■ 📊 VITALS` |
| Today's logs | `■ 📅 TODAY'S LOGS` |
| Settings groups | `■ [relevant emoji] [SECTION NAME]` |
| Notifications | `■ 🔔 NOTIFICATIONS` |
| Appearance | `■ 🎨 APPEARANCE` |
| Account | `■ 👤 ACCOUNT` |
| Friend / partner | `■ 🤝 FRIEND` |

---

## 4. Physical Metaphor Components

These are components that deliberately reference real-world physical objects. Physical accuracy is not optional - an inaccurate metaphor becomes a cartoon. Every property documented here exists for a specific accuracy reason.

### 4.1 Translucent Tape

Tape is a translucent material. You see the surface beneath it. A solid rectangle is a sticker. Only a translucent warm-tinted rectangle is tape.

```css
.tape-clip {
  position: absolute;
  top: -9px;
  left: 50%;
  transform: translateX(-50%);
  width: 48px;
  height: 18px;
  background: rgba(230, 200, 120, 0.28);
  border: 1px solid rgba(180, 155, 80, 0.35);
  box-shadow:
    0 1px 2px rgba(0, 0, 0, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.4);
  z-index: 2;
}
```

**Why each property exists:**
- `rgba(230, 200, 120, 0.28)`: warm amber tint at low opacity. The dot matrix behind shows through. The exact hue approximates the warm yellow of scotch tape.
- `border: 1px solid rgba(180, 155, 80, 0.35)`: tape has a material edge, not a printed edge. Semi-transparent, same hue family, 1px only.
- `0 1px 2px rgba(0,0,0,0.12)`: tape sits slightly above the polaroid surface. This is a real thin shadow from a thin flat material, not the hard offset of a heavy object.
- `inset 0 1px 0 rgba(255,255,255,0.4)`: the top surface of tape catches light. This single inset line creates the subtle sheen that makes it read as a physical material.
- `top: -9px`: the tape clip is half on the card, half off it. Real tape applied to pin a photo overlaps the edge. It is not centered within the card top edge.

**Common mistakes:**
- Using `background: #F5C518` (solid yellow = sticker, not tape)
- Using `border: 2px solid #000` (tape has no stamped edge)
- Setting `top: 0` (tape applied to the surface, not overlapping)
- Missing the `inset` shadow (makes it look like a flat film rather than tape)

### 4.2 Polaroid Cards

A polaroid photo has specific physical properties that must be preserved to sell the metaphor.

```css
.polaroid-card {
  background: #fafaf7;        /* warm white - physical paper is never pure white */
  border: 1.5px solid #1a1a1a; /* slightly off-black - photo border, not print border */
  padding: 8px 8px 28px 8px;  /* fat bottom: the defining polaroid proportion */
  box-shadow: 3px 3px 0px 0 #1a1a1a; /* offset shadow: photo sitting on surface */
  position: relative;          /* for tape clip z-positioning */
}

/* Alternating rotation - uniformity destroys the physical metaphor */
.polaroid-card:nth-child(odd)  { transform: rotate(-0.8deg); }
.polaroid-card:nth-child(even) { transform: rotate(0.6deg); }
.polaroid-card:nth-child(3n)   { transform: rotate(1.1deg); }
```

**Why each property exists:**
- `#fafaf7` not `#ffffff`: physical photo paper has a warm cream cast. Pure white reads as UI component. Cream reads as paper.
- `1.5px solid #1a1a1a`: the photo border is a manufactured material edge, slightly softer than 2px stamped black. Using `#000` is too aggressive.
- `padding: 8px 8px 28px 8px`: the bottom is 3.5x the side padding. This is the proportional signature of a polaroid. Miss this and it's just a white-framed card.
- `3px 3px 0`: slightly smaller than the standard 4px. Photos are thin objects, lighter shadow than a thick card.
- Rotation: alternating variation between approximately `-1.1deg` and `+1.1deg` is the range. Beyond `±1.5deg` looks intentionally tilted rather than casually placed.

**Album art inside the polaroid:**
```css
.polaroid-art {
  width: 100%;
  aspect-ratio: 1;
  border: 2px solid #000000; /* art has its own frame inside the photo border */
  display: block;
  object-fit: cover;
}
```

The nested border treatment (a 2px black border inside the polaroid frame) creates the layered physical object quality: you see the photo border, then the art's own frame inside it.

### 4.3 Skewed Typographic Stickers (Metadata Badges)

Stickers are opaque, have a slight rotation, and break the boundary of their parent container. They are applied after the layout is set, not laid out within it.

```css
/* Genre / year sticker - bottom-right, breaking card boundary */
.sticker-genre {
  position: absolute;
  bottom: -6px;
  right: -6px;
  background: #F5C518;
  color: #000000;
  border: 2px solid #000000;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  padding: 3px 8px;
  transform: rotate(-2deg);
  z-index: 2;
}

/* Format sticker - top-left, flush to art corner, no rotation */
.sticker-format {
  position: absolute;
  top: 0;
  left: 0;
  background: #000000;
  color: #ffffff;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  padding: 3px 8px;
  z-index: 2;
}

/* Name / identity sticker - inverted, bold, slightly rotated */
.sticker-identity {
  display: inline-block;
  background: #000000;
  color: #ffffff;
  font-size: 16px;
  font-weight: 800;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  padding: 4px 12px;
  transform: rotate(-1.5deg);
}
```

**Sticker rules:**
- Stickers rotate. The rotation range is `-2deg` to `+2deg`. Outside that range they look intentionally tilted.
- Stickers break their parent's boundary. `bottom: -6px` or `right: -6px` is correct. `bottom: 8px` inside the card is a pill, not a sticker.
- The format sticker (FLAC, MP3, etc.) does not rotate - it is a technical stamp applied flush to the corner.
- The identity sticker (user name, "ENTRY LOG") rotates slightly and uses white-on-black inversion.

### 4.4 The Legal Pad (Text Areas)

Standard textarea elements in this system are styled as physical legal pads. The metaphor invites long-form writing by making the text area feel like a familiar physical writing surface.

```css
.legal-pad-textarea {
  background-color: #FDF6A4;  /* pale yellow legal pad color */
  background-image:
    /* Red margin line - single vertical rule at 24px from left */
    linear-gradient(to right, transparent 23px, rgba(220, 80, 80, 0.35) 23px, rgba(220, 80, 80, 0.35) 24px, transparent 24px),
    /* Blue horizontal ruling - repeating at line-height intervals */
    repeating-linear-gradient(
      to bottom,
      transparent,
      transparent 27px,
      rgba(100, 149, 237, 0.4) 27px,
      rgba(100, 149, 237, 0.4) 28px
    );
  border: 2px solid #000000;
  box-shadow: 4px 4px 0px 0px #000000;
  padding: 12px 12px 12px 32px; /* left indent clears the margin line */
  font-size: 15px;
  font-family: inherit;
  line-height: 28px; /* must match the repeating-linear-gradient interval */
  color: #1a1a1a;
  resize: vertical;
  width: 100%;
  box-sizing: border-box;
}

.legal-pad-textarea:focus {
  outline: none;
  /* Legal pads do not change color on focus - the paper is the paper */
  /* The cursor alignment with ruled lines is the focus signal */
}
```

**Construction details:**
- The horizontal ruling interval (28px) must match the `line-height` exactly. If they diverge, text floats off the lines.
- The left padding (32px) must clear the red margin line (24px + 8px breathing room). Text written in the margin breaks the metaphor.
- The ruling lines are `rgba` blue at 0.4 opacity - visible but not dominant. Legal pad lines are helpful guides, not bold graphics.
- The margin line is `rgba` red at 0.35 opacity - similarly present but not aggressive.
- The border and shadow are standard system values. The legal pad is still a UI object sitting on the surface with the same physics as everything else.

**Component pairing:**
The legal pad label uses a small sticker-style badge rather than a standard field label:
```css
.legal-pad-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: #7CC61F;   /* or any semantic accent */
  border: 2px solid #000;
  padding: 3px 10px;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  margin-bottom: -2px;   /* overlaps the textarea top border slightly */
  position: relative;
  z-index: 1;
}
```

The label overlaps the textarea top border, creating the sticker-applied-to-surface effect.

### 4.5 The Status Card (Full-Bleed Connection State)

When a card represents a live connection, relationship, or active partnership, its entire background fills with lime green. This is not a border color change or a badge - it is a total environmental shift that communicates "this relationship is live."

```css
.status-card {
  background: #7CC61F;
  border: 2px solid #000000;
  box-shadow: 4px 4px 0px 0px #000000;
  padding: 12px 16px;
}

.status-card .status-name {
  font-size: 20px;
  font-weight: 800;
  text-transform: uppercase;
  color: #000000;
}

.status-card .status-sub {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: rgba(0,0,0,0.6);
  display: flex;
  align-items: center;
  gap: 6px;
}

/* The embedded action button inside the green card */
.status-card .status-action {
  display: block;
  width: 100%;
  margin-top: 12px;
  background: #F5C518;
  border: 2px solid #000000;
  box-shadow: 2px 2px 0px 0px #000000;
  padding: 10px 16px;
  font-size: 13px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  text-align: center;
  cursor: pointer;
  color: #000000;
}

.status-card .status-action:active {
  transform: translate(2px, 2px);
  box-shadow: none;
}
```

**Key detail:** The action button inside the green card uses a 2px nested shadow (not 4px) because it is a physical object resting on top of another physical object. The nesting reduces its shadow relative to its container, preserving the physical depth hierarchy.

### 4.6 The Receipt Pattern

When summarizing submitted data, the layout references a thermal printer receipt. This format is strictly columnar, monospaced, and deliberately mechanical.

```css
.receipt-container {
  background: #ffffff;
  border: 2px solid #000000;
  box-shadow: 4px 4px 0px 0px #000000;
  padding: 16px;
  font-family: 'Courier New', monospace;
}

.receipt-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding: 4px 0;
  border-bottom: 1px dashed #cccccc;  /* dashed separator mimics perforated receipt paper */
}

.receipt-row:last-child {
  border-bottom: none;
}

.receipt-label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: #888888;
  text-align: left;
}

.receipt-value {
  font-size: 14px;
  font-weight: 700;
  color: #000000;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

/* Header stamp at top of receipt */
.receipt-header {
  font-size: 18px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  text-align: center;
  padding-bottom: 12px;
  border-bottom: 2px solid #000000;
  margin-bottom: 12px;
}

/* Totals row - emphasized */
.receipt-total {
  border-top: 2px solid #000000;
  margin-top: 8px;
  padding-top: 8px;
}

.receipt-total .receipt-value {
  font-size: 20px;
}
```

**Receipt rules:**
- Labels are strictly left-aligned.
- Values are strictly right-aligned.
- `justify-content: space-between` on each row with no exceptions.
- Row separators use `1px dashed #cccccc` - dashed mimics perforated receipt paper.
- The header is centered and uses a solid 2px rule, not dashed.
- All text is monospaced. Using a proportional font breaks the receipt metaphor entirely.
- `font-variant-numeric: tabular-nums` ensures numbers align vertically across rows.

---

## 5. Component Specifications

### 5.1 Cards

The primary container primitive. Every card is a physical object: white or accent-filled, hard-bordered, hard-shadowed, pressable.

```css
.neo-card {
  background: #ffffff;
  border: 2px solid #000000;
  box-shadow: 4px 4px 0px 0px #000000;
  border-radius: 0;
  padding: 16px;
  cursor: pointer;
  transition: transform 80ms ease-out, box-shadow 80ms ease-out;
}

.neo-card:active {
  transform: translate(4px, 4px);
  box-shadow: none;
}

/* Active / playing state - full-bleed color fill */
.neo-card.is-playing {
  background: #7CC61F;
}

/* Nested image frame within card */
.neo-card-image {
  border: 2px solid #000000;
  display: block;
  width: 100%;
  aspect-ratio: 1;
  object-fit: cover;
}
```

**Card anatomy:**
1. Outer border (2px black)
2. Hard offset shadow (4px 4px, black)
3. Optional colored title strip at the top
4. Content body with padding
5. Optional nested image frame (inner 2px black border)
6. Optional tag pills at the bottom

### 5.2 Primary CTA Button (The Overflowing Play Action)

The single most important action in any view. It breaks the plane of its container.

```css
.neo-cta-primary {
  width: 64px;
  height: 64px;
  background: #000000;
  color: #ffffff;
  border: 2px solid #000000;
  box-shadow: 4px 4px 0px 0px #F5C518;   /* yellow shadow exclusively */
  border-radius: 0;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  top: -16px;                             /* breaks container top plane */
  margin-bottom: -16px;                   /* reabsorbs the overflow */
  transition: transform 80ms ease-out, box-shadow 80ms ease-out;
}

.neo-cta-primary:active {
  transform: translate(4px, 4px);
  box-shadow: none;
}
```

**Rules:**
- The yellow shadow is what makes this the highest element in the visual hierarchy. It is the only yellow shadow in the entire system. Do not use yellow shadows on anything else.
- There is exactly one overflowing CTA per view.
- It must break the container plane. `top: -16px` is the minimum. This is non-negotiable.
- Square. Never rounded. Never circular.

### 5.3 Secondary Button

```css
.neo-btn {
  background: #ffffff;
  color: #000000;
  border: 2px solid #000000;
  box-shadow: 4px 4px 0px 0px #000000;
  padding: 10px 20px;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  border-radius: 0;
  cursor: pointer;
  transition: transform 80ms ease-out, box-shadow 80ms ease-out;
}

.neo-btn:active {
  transform: translate(4px, 4px);
  box-shadow: none;
}

/* Utility variant - yellow fill */
.neo-btn.utility {
  background: #F5C518;
}

/* Full-width variant (e.g. NUDGE button inside status card) */
.neo-btn.full-width {
  display: block;
  width: 100%;
  text-align: center;
}

/* Danger variant */
.neo-btn.danger {
  background: #E53935;
  color: #ffffff;
  box-shadow: 4px 4px 0px 0px #000000;
}

/* Nested variant - smaller shadow for button-within-card */
.neo-btn.nested {
  box-shadow: 2px 2px 0px 0px #000000;
  padding: 5px 12px;
  font-size: 10px;
}

.neo-btn.nested:active {
  transform: translate(2px, 2px);
}
```

### 5.4 Binary Mechanical Toggle

Replaces all icon-based toggle buttons. The entire control reads as a single labeled switch split into two halves.

```css
.neo-toggle {
  display: flex;
  width: 80px;
  height: 28px;
  border: 2px solid #000000;
  overflow: hidden;
  cursor: pointer;
  user-select: none;
}

.neo-toggle-half {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 9px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  transition: background 100ms ease;
}

/* Active state */
.neo-toggle[data-active="true"] .neo-toggle-on {
  background: #7CC61F;
  color: #000000;
}
.neo-toggle[data-active="true"] .neo-toggle-off {
  background: #e0e0e0;
  color: #888888;
}

/* Inactive state */
.neo-toggle[data-active="false"] .neo-toggle-on {
  background: #e0e0e0;
  color: #888888;
}
.neo-toggle[data-active="false"] .neo-toggle-off {
  background: #e0e0e0;
  color: #000000;
}
```

```html
<!-- Usage -->
<div class="neo-toggle" data-active="true" onclick="...">
  <div class="neo-toggle-half neo-toggle-on">ON</div>
  <div class="neo-toggle-half neo-toggle-off">OFF</div>
</div>
```

**Use cases:** shuffle, repeat, crossfade, hardware decoder, morning notifications, evening notifications, any binary preference toggle in settings.

**The toggle must never:** use an icon alone without ON/OFF text, use a rounded pill shape, use a sliding thumb/handle. The entire left half is "ON" and the entire right half is "OFF". The fill change is the state indicator.

### 5.5 Seek Bar / Progress Track (Ruler Pattern)

Physical ruler aesthetic. Ticks, fill, floating timestamp badge.

```css
.neo-seek-wrap {
  position: relative;
  padding-top: 32px; /* space for the floating badge above */
}

.neo-seek-track {
  position: relative;
  height: 14px;
  background: #e0e0e0;
  border: 2px solid #000000;
  cursor: pointer;
  overflow: visible;
}

.neo-seek-fill {
  position: absolute;
  left: 0;
  top: 0;
  height: 100%;
  background: #7CC61F;
  pointer-events: none;
  transition: width 0.1s linear;
}

/* Shifts to amber in the final 20% of track duration */
.neo-seek-fill.near-end {
  background: #E8A020;
}

.neo-seek-tick {
  position: absolute;
  top: 0;
  width: 1px;
  height: 8px;
  background: rgba(0,0,0,0.3);
  pointer-events: none;
}

/* Floating timestamp badge - follows playhead */
.neo-seek-badge {
  position: absolute;
  top: -28px;
  transform: translateX(-50%);
  background: #000000;
  color: #ffffff;
  font-size: 10px;
  font-weight: 700;
  font-family: 'Courier New', monospace;
  padding: 2px 6px;
  border: 2px solid #000000;
  white-space: nowrap;
  pointer-events: none;
  z-index: 2;
}
```

**Implementation:** render 11 ticks at 10% intervals (0%, 10%, 20%...100%) using `left: X%`. The badge's `left` position is set via JavaScript to `currentTime / duration * 100 + '%'`. When `currentTime / duration > 0.8`, add the `near-end` class to the fill.

### 5.6 Segmented Volume Control

Volume expressed as 10 discrete, individually clickable square segments.

```css
.neo-volume {
  display: flex;
  gap: 2px;
  align-items: center;
}

.neo-volume-seg {
  width: 16px;
  height: 10px;
  border: 1px solid #000000;
  background: #e0e0e0;
  cursor: pointer;
  transition: background 60ms;
}

.neo-volume-seg.active {
  background: #7CC61F;
}

/* Optional: mute icon before the segments */
.neo-volume-icon {
  width: 16px;
  height: 16px;
  margin-right: 6px;
  cursor: pointer;
}
```

Click on segment N sets volume to N/10. No sliding. Quantized. Deliberate.

### 5.7 Segmented Sliders and Data Viz (10-Block Track)

For data input (vitals, ratings, scales) and passive data visualization (bar charts, scores). The same component works for both. Input mode has an interactive thumb. Display mode removes it.

```css
.neo-block-track {
  display: flex;
  gap: 2px;
  position: relative;
  height: 20px;
}

.neo-block-seg {
  flex: 1;
  border: 1px solid #000000;
  background: #e0e0e0;
  cursor: pointer;
  transition: background 60ms;
  height: 100%;
}

/* Active/filled segments */
.neo-block-seg.filled {
  /* Color varies by semantic: yellow for neutral, green for positive, red for negative */
}

/* The floating numeric badge / thumb - snaps to end of filled region */
.neo-block-badge {
  position: absolute;
  top: 50%;
  transform: translate(-50%, -50%);
  background: #000000;
  color: #ffffff;
  font-size: 11px;
  font-weight: 800;
  font-family: 'Courier New', monospace;
  width: 28px;
  height: 28px;
  border: 2px solid #000000;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  z-index: 3;
}

/* Scale labels below the track */
.neo-block-labels {
  display: flex;
  justify-content: space-between;
  margin-top: 4px;
}

.neo-block-label {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: #888888;
}

/* Emoji icon at left of slider row (for vitals) */
.neo-slider-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 0;
}

.neo-slider-icon {
  width: 44px;
  height: 44px;
  border: 2px solid #000000;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  flex-shrink: 0;
}
```

**Vitals slider construction:**
```
[EMOJI ICON] [LABEL]
             [████████░░] [BADGE: 8]
             GOOD                SEVERE
```

The emoji icon is framed in its own 44×44px bordered square. The label is Level 2 text. The block track fills from left. The badge snaps to the right edge of the filled region.

**Color semantics for block fills:**

| Scale type | Fill color | Meaning |
|---|---|---|
| Positive (mood, health, energy) | `#7CC61F` | Higher = better |
| Negative (depression, anxiety, pain) | Reddish pink `#f4a0a0` or red | Higher = worse |
| Neutral (volume, brightness) | `#F5C518` | No valence |

### 5.8 Dashed Dropzones (Media Input)

Empty upload areas use dashed borders to signal "awaiting content."

```css
.neo-dropzone {
  border: 2px dashed #000000;
  box-shadow: 4px 4px 0px 0px #000000;
  background: #ffffff;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 32px 16px;
  cursor: pointer;
  transition: transform 80ms, box-shadow 80ms;
}

.neo-dropzone:active {
  transform: translate(4px, 4px);
  box-shadow: none;
}

/* When a file is dragging over the zone */
.neo-dropzone.drag-over {
  background: #F5C518;
  border-style: solid;  /* switches from dashed to solid on hover */
}

.neo-dropzone-icon {
  font-size: 28px;
  opacity: 0.6;
}

.neo-dropzone-label {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: #888888;
}
```

**The dashed border communicates:** this frame is empty, waiting to be filled. When it fills, the border becomes solid. This is a consistent semiotic rule: dashed = empty/pending, solid = complete/filled.

### 5.9 Top-Level Tab Bar

The primary routing control. Tabs are not independent buttons - they are segments of a single bordered container, separated by internal dividers.

```css
.neo-tabbar {
  display: flex;
  border: 2px solid #000000;
  box-shadow: 4px 4px 0px 0px #000000;
  overflow: hidden;
}

.neo-tab {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 12px 16px;
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  cursor: pointer;
  border-right: 2px solid #000000;
  background: #ffffff;
  color: #000000;
  transition: background 80ms, color 80ms;
}

.neo-tab:last-child {
  border-right: none;
}

/* Active state: full inversion */
.neo-tab.active {
  background: #000000;
  color: #ffffff;
}

/* The tab bar container gets the shadow, not individual tabs */
```

**Critical rule:** the shadow belongs to the container, not the individual tabs. Giving each tab its own shadow is a common mistake that makes the group feel like separate buttons. One shadow on the container reads as one grouped control.

**Active state:** full black fill with white text. Not yellow. The tab bar inversion is a different semantic from the yellow active nav state (which is for persistent navigation). Tab bars express document-level view selection, not spatial location within the app.

### 5.10 Modal Overlays

Modals are sharp, flat, and heavy. No blur on the backdrop. No soft shadow on the container.

```css
/* Backdrop - flat black at 50% opacity, zero blur */
.neo-modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

/* Modal container */
.neo-modal {
  background: #ffffff;
  border: 2px solid #000000;
  box-shadow: 6px 6px 0px 0px #000000;  /* 6px: heavier than cards to lift above backdrop */
  padding: 0;
  width: clamp(300px, 90vw, 540px);
  max-height: 90vh;
  overflow-y: auto;
  position: relative;
}

/* Modal title strip */
.neo-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 2px solid #000000;
  background: #ffffff;
}

.neo-modal-title {
  font-size: 16px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

/* Close button - stark bordered square with X */
.neo-modal-close {
  width: 32px;
  height: 32px;
  border: 2px solid #000000;
  background: #ffffff;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-size: 16px;
  font-weight: 700;
  transition: transform 80ms, box-shadow 80ms;
  box-shadow: 2px 2px 0 #000000;
}

.neo-modal-close:active {
  transform: translate(2px, 2px);
  box-shadow: none;
}

/* Modal body */
.neo-modal-body {
  padding: 16px;
}
```

**Modal rules:**
- The backdrop is `rgba(0,0,0,0.5)` flat. No `backdrop-filter: blur()`. Ever.
- The modal uses 6px shadow (heavier than cards) to establish it as the topmost physical layer.
- The close button is a 32×32px bordered square with an X - stark, mechanical, unambiguous.
- The modal has a title strip at the top with a 2px border-bottom separator. This is the same window-title pattern used throughout the system.
- Entry animation: `transform: translateY(-8px)` to `translateY(0)` at 150ms. Not a scale. Not a fade. A physical drop.

### 5.11 Radio Selection Cards

Large selectable areas for choosing between modes, themes, or presets. These are not standard radio buttons - they are large cards with an indicator circle.

```css
.neo-radio-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 12px;
}

.neo-radio-card {
  position: relative;
  border: 2px solid #000000;
  box-shadow: 4px 4px 0px 0px #000000;
  padding: 16px 16px 48px 16px;  /* bottom space for label */
  cursor: pointer;
  background: #ffffff;
  min-height: 120px;
  transition: transform 80ms, box-shadow 80ms;
}

.neo-radio-card:active {
  transform: translate(4px, 4px);
  box-shadow: none;
}

/* Indicator circle - top right */
.neo-radio-indicator {
  position: absolute;
  top: 12px;
  right: 12px;
  width: 18px;
  height: 18px;
  border: 2px solid #000000;
  border-radius: 50%;
  background: #ffffff;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* Inner dot when selected */
.neo-radio-indicator::after {
  content: '';
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #000000;
  opacity: 0;
  transition: opacity 100ms;
}

.neo-radio-card.selected .neo-radio-indicator::after {
  opacity: 1;
}

/* Label at bottom of card */
.neo-radio-label {
  position: absolute;
  bottom: 12px;
  left: 16px;
  font-size: 13px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #000000;
}

/* When selected, the background shifts to the theme color */
.neo-radio-card.selected {
  /* Background color is set inline or via modifier class matching the option */
}
.neo-radio-card.selected-retro { background: #ffffff; }
.neo-radio-card.selected-neo   { background: #A855F7; color: #ffffff; }
.neo-radio-card.selected-neo .neo-radio-label { color: #ffffff; }
```

**Key detail:** when selected, the entire card background shifts to the theme or mode's representative color. The card physically shows you what you are selecting. A pure white "RETRO" card and a purple "NEO" card next to each other communicate the aesthetic choice before you read a single label.

### 5.12 Context Toggle Pill (Day/Night, Mode State)

A small bordered pill in the top-right of a view header that communicates the current temporal or modal context.

```css
.neo-context-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 2px solid #000000;
  background: #F5C518;
  padding: 4px 12px;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #000000;
  cursor: pointer;
  transition: transform 80ms, box-shadow 80ms;
  box-shadow: 2px 2px 0 #000000;
}

.neo-context-pill:active {
  transform: translate(2px, 2px);
  box-shadow: none;
}

.neo-context-pill-icon {
  font-size: 13px;
}

/* Night mode variant */
.neo-context-pill.night {
  background: #1a1a1a;
  color: #ffffff;
  border-color: #000000;
}
```

**Typical placements:**
- `SAT, MAR 21` + `🌙 NIGHT` in the header of a daily log entry
- `☀ DAYTIME` / `🌙 LATE NIGHT` in the TopBar
- Mode toggles: `▶ PLAYING` / `⏸ PAUSED` as a status badge

**Rule:** the pill is always positioned top-right of its parent header, slightly overlapping the bottom border of the header row (like a sticker applied to the header, not inside it).

### 5.13 Streak / Counter Tile

A self-contained framed tile displaying a large numeric value with an emoji icon and label.

```css
.neo-counter-tile {
  background: #ffffff;
  border: 2px solid #000000;
  box-shadow: 4px 4px 0px 0px #000000;
  padding: 24px 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.neo-counter-icon {
  font-size: 32px;
  margin-bottom: 8px;
}

.neo-counter-value {
  font-size: 56px;
  font-weight: 900;
  line-height: 1;
  letter-spacing: -0.03em;
  color: #000000;
  font-variant-numeric: tabular-nums;
}

.neo-counter-label {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: #888888;
  margin-top: 4px;
}
```

**Usage:** streak counts, play counts, total tracks, days active, unread notifications. The counter tile presents a single number at maximum visual scale. It is not a dashboard widget with multiple metrics - it is a single number that needs to communicate instantly.

### 5.14 Full-Width Embedded Action Button

A button that stretches the full internal width of its parent card. Used for primary actions embedded inside status cards, confirmation panels, or contextual drawers.

```css
.neo-btn-embedded-full {
  display: block;
  width: 100%;
  background: #F5C518;
  border: 2px solid #000000;
  box-shadow: 2px 2px 0px 0px #000000;  /* nested shadow */
  padding: 12px 16px;
  font-size: 14px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  text-align: center;
  cursor: pointer;
  color: #000000;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  transition: transform 80ms, box-shadow 80ms;
}

.neo-btn-embedded-full:active {
  transform: translate(2px, 2px);
  box-shadow: none;
}
```

The button stretches wall-to-wall inside the card, touching the card's inner edges. This removes all ambiguity about where to tap. It is not centered with margins - it fills the available width completely.

**Quantified labels:** include counts or limits directly in the button label when finite resources are involved. `NUDGE (5 LEFT)` not `NUDGE`. The count is part of the action's meaning.

### 5.15 Emoji Avatar with Edit State

User avatars in this system are not photos. They are bordered squares containing a large emoji character.

```css
.neo-avatar {
  width: 64px;
  height: 64px;
  border: 2px solid #000000;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 32px;
  background: #f5f5f0;
  flex-shrink: 0;
  position: relative;
}

/* Edit indicator - small pencil badge overlapping corner */
.neo-avatar-edit {
  position: absolute;
  bottom: -6px;
  right: -6px;
  width: 22px;
  height: 22px;
  background: #ffffff;
  border: 2px solid #000000;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  cursor: pointer;
  z-index: 2;
}
```

The edit indicator is a small 22×22px bordered square at the bottom-right corner, partially breaking the avatar boundary, containing a ✏️ icon. It uses the same corner-break pattern as the sticker badges.

### 5.16 File Count Overlay Badge

Displayed on the top-left corner of album art or media thumbnails. Communicates content count without requiring the user to open the item.

```css
.neo-file-badge {
  position: absolute;
  top: 0;
  left: 0;
  background: rgba(0, 0, 0, 0.75);
  color: #ffffff;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  padding: 3px 8px;
  z-index: 2;
  pointer-events: none;
}
```

`rgba(0,0,0,0.75)` not `#000000` - the badge is semi-transparent so the album art color bleeds through slightly, connecting the badge to the art rather than stamping an opaque block over it. The text remains fully legible at this opacity.

### 5.17 Danger Zone Container

Destructive actions are isolated within their own clearly signaled container. They are never mixed in with standard settings rows.

```css
.neo-danger-zone {
  border: 2px solid #000000;
  box-shadow: 4px 4px 0px 0px #000000;
  background: #ffffff;
  padding: 12px 16px;
  display: flex;
  align-items: center;
  gap: 12px;
}

.neo-danger-icon {
  width: 36px;
  height: 36px;
  background: #FECACA;  /* light red surface */
  border: 2px solid #E53935;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  flex-shrink: 0;
}

.neo-danger-label {
  color: #E53935;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  line-height: 1.3;
}

.neo-danger-sub {
  font-size: 11px;
  font-weight: 400;
  color: #888888;
  text-transform: none;
  letter-spacing: 0;
}

.neo-danger-btn {
  margin-left: auto;
  background: #E53935;
  color: #ffffff;
  border: 2px solid #000000;
  box-shadow: 3px 3px 0 #000000;
  padding: 8px 16px;
  font-size: 11px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  cursor: pointer;
  flex-shrink: 0;
  transition: transform 80ms, box-shadow 80ms;
}

.neo-danger-btn:active {
  transform: translate(3px, 3px);
  box-shadow: none;
}
```

---

## 6. Layout Patterns

### 6.1 Card Grid Redundancy Rule

Before adding any badge or tag to a card, answer: does the user already know this from the current view context? If yes, remove it.

**The test:** cover the section header and view title. Can the user still understand what type of content this card contains from the card alone? If yes, the contextual information is genuinely needed. If no (because the header already told them), remove it.

**Correct:** Year badge only on album cards in the Albums view.
**Incorrect:** ALBUM badge on every card in the Albums view. ARCHIVE badge on every card in the Archive view.

The practical rule: show only metadata that varies between cards in the same view. Year varies. Format varies. File count varies. "It is an album" does not vary in the Albums view.

### 6.2 Filter Bar vs Sort Control

Browse filters (what you are looking at) and sort controls (how it is ordered) are categorically different and must be visually separated.

```
[ALBUMS 8] [SONGS 157] [ARTISTS 5] [RECENT 50] [MOST PLAYED 20]    SORT: DATE ADDED ▾
|←—————————————— browse filters ——————————————→|    |←— sort —→|
```

The browse filters are equal-weight segment pills in a row. The sort control is a compact labeled dropdown pushed to the far right. They share the same horizontal band but are separated by a significant gap.

### 6.3 The Overflowing Primary Action

The single most important action per view breaks the container plane.

**Rules:**
- `position: relative; top: -16px;` relative to the nav/dock container top edge
- Uses the yellow shadow variant exclusively
- Maximum one overflowing element per view
- Never rounded corners
- The element above which it overflows must have `overflow: visible` or the overflow clips

### 6.4 Nested Object Pattern

A button placed inside a card is a separate physical object layered on top of the card. It gets its own border and a reduced shadow.

```
┌──────────────────────────────────────────┐
│ Card background                          │
│                                          │
│ ┌────────────────────────────────┐       │
│ │ Nested button (2px shadow)     │       │
│ └────────────────────────────────┘       │
│                                          │
└──────────────────────────────────────────┘
```

The 2px nested shadow (vs the 4px card shadow) establishes the physical depth: the button sits on top of the card, the card sits on top of the surface.

### 6.5 The Receipt Pattern

See Section 4.6 for full implementation. Layout principle: single-column, label-left, value-right, monospaced, dashed row separators.

### 6.6 The Vitals / Form Panel

A bordered panel containing multiple slider rows, each with an emoji icon, label, 10-block track, and pole labels.

```
┌──────────────────────────────────────────────────┐
│ ■ 📊 VITALS                                       │
│ ─────────────────────────────────────────────── │
│                                                   │
│ DEPRESSION                                        │
│ [😊] [██░░░░░░░░] [2]                            │
│      GOOD              SEVERE                     │
│ ─────────────────────────────────────────────── │
│                                                   │
│ ANXIETY                                           │
│ [🌪] [████████████████████] [10]                │
│      CALM              PANIC                      │
│ ─────────────────────────────────────────────── │
│                                                   │
│ MOOD                                              │
│ [😎] [████████████████████] [10]                │
│      BAD               RAD                        │
└──────────────────────────────────────────────────┘
```

Each slider row has:
1. A label above (`DEPRESSION`, `ANXIETY`, `MOOD`) in Level 2 typography
2. An emoji icon in a 44×44 bordered square on the left
3. A 10-block track filling the remaining width
4. A floating black badge with the numeric value snapped to the track right edge
5. Two pole labels below the track (`GOOD / SEVERE`, `CALM / PANIC`, `BAD / RAD`)
6. A thin `1px solid #E5E5E5` separator between each slider row

### 6.7 Account / Profile Block

The standard settings profile card. Two-column layout: avatar on left, metadata on right.

```css
.neo-profile-card {
  display: flex;
  align-items: center;
  gap: 16px;
  border: 2px solid #000000;
  box-shadow: 4px 4px 0 #000000;
  background: #ffffff;
  padding: 16px;
}

.neo-profile-meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.neo-profile-field-label {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: #888888;
}

.neo-profile-field-value {
  font-size: 22px;
  font-weight: 800;
  letter-spacing: -0.01em;
  color: #000000;
}
```

The field label (`USERNAME`, `FRIEND CODE`) is Level 3 typography above the value. The value is Level 4 typography. This stack creates the settings-form aesthetic where everything reads as a labeled data field.

---

## 7. Navigation Architecture

### 7.1 The Grouped Navigation Bar

The primary navigation tabs are grouped inside a single bordered container with internal 2px dividers between tabs. The group gets one shadow. Individual tabs do not.

```css
.neo-nav-group {
  display: flex;
  border: 2px solid #000000;
  box-shadow: 4px 4px 0px 0px #000000;
  overflow: hidden;
}

.neo-nav-tab {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 20px;
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  cursor: pointer;
  border-right: 2px solid #000000;
  background: #ffffff;
  color: #000000;
  white-space: nowrap;
  transition: background 80ms;
}

.neo-nav-tab:last-child {
  border-right: none;
}

/* Active state: yellow square behind icon only, not full tab fill */
.neo-nav-tab.active {
  background: #ffffff;  /* tab background stays white */
}

.neo-nav-tab.active .nav-icon-wrap {
  background: #F5C518;
  padding: 4px;
  border: 1px solid #000000;
}
```

**Two-group layout:** primary navigation (HOME, LIBRARY, QUEUE) on the left as one grouped container; secondary navigation (TAGS, SETTINGS) on the right as separate individual bordered buttons. They share the same horizontal baseline but are visually distinct groups because they serve different purposes (primary routing vs utility access).

### 7.2 The Bottom Dock

On mobile or compact layouts, navigation moves to a bottom dock with the primary CTA overflowing it.

```css
.neo-dock {
  display: flex;
  align-items: center;
  border-top: 2px solid #000000;
  background: #ffffff;
  padding: 0 16px;
  height: 60px;
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  overflow: visible;  /* critical: allows the CTA to overflow upward */
}

.neo-dock-tab {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  cursor: pointer;
  position: relative;
}

/* Active tab: yellow square fill */
.neo-dock-tab.active {
  background: #F5C518;
  border: 2px solid #000000;
  margin: 8px 4px;
}

/* Center CTA that overflows the dock */
.neo-dock-cta {
  position: relative;
  top: -16px;       /* overflows the dock top by 16px */
  margin: 0 4px;
  flex-shrink: 0;
  /* Uses .neo-cta-primary styles */
}
```

The overflowing center button is the single most visible element in the interface when the dock is visible. Its yellow shadow, black fill, and broken-plane positioning create an involuntary focal point. The user does not have to look for the primary action.

### 7.3 Secondary Utility Navigation

TAGS, SETTINGS, and other utility destinations appear as independent bordered buttons to the right of the grouped primary navigation. They are not inside the group container.

```css
.neo-util-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  border: 2px solid #000000;
  box-shadow: 4px 4px 0 #000000;
  background: #ffffff;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  cursor: pointer;
  white-space: nowrap;
  transition: transform 80ms, box-shadow 80ms;
}

.neo-util-btn:active {
  transform: translate(4px, 4px);
  box-shadow: none;
}
```

---

## 8. Color System

### 8.1 Core palette

#### Structural (applied everywhere)
- Ink: `#000000`
- Near-ink (polaroid/photo borders): `#1a1a1a`
- Paper (clean white surfaces): `#FFFFFF`
- Warm paper (polaroid, card surfaces): `#fafaf7`
- Canvas warm (dot matrix base): `#e9e9e9`
- Surface muted: `#F5F5F0`
- Border neutral: `#E5E5E5`
- Secondary text: `#888888`
- Inactive fill: `#e0e0e0`

#### Semantic accents
- Primary CTA / active nav: `#F5C518` (yellow)
- Active / playing state: `#7CC61F` (lime green)
- Seek bar amber end: `#E8A020` (amber - passive state shift only)
- Destructive: `#E53935` (red)
- Danger surface light: `#FECACA` (light red - icon backgrounds in danger zone)

#### Legal pad specific
- Pad surface: `#FDF6A4`
- Ruling blue: `rgba(100, 149, 237, 0.4)`
- Margin red: `rgba(220, 80, 80, 0.35)`

#### Extended palette (use case specific)
- Purple: `#A855F7` (theme selector, creative tools)
- Blue: `#3B82F6` (informational states, links)
- Orange: `#FB923C` (warning states)
- Pink: `#F472B6` (creative/expressive contexts)

### 8.2 Color usage rules

1. `#F5C518` appears on: active nav fill, primary CTA shadow (yellow shadow only), utility button fill, focused input background. Nowhere else.
2. `#7CC61F` appears on: currently playing card fill, active playlist row fill, seek bar fill, volume segment fill, mechanical toggle active half. Nowhere else.
3. `#E53935` appears on: destructive button fill, danger zone label text, danger zone icon border. Nowhere else.
4. `#000000` is the universal ink. It appears on all borders, all hard shadows, all section rules, all primary text.
5. No accent color appears on more than one semantic role.
6. No two accent colors appear simultaneously on the same element.
7. The seek bar amber shift (`#E8A020`) is passive and ambient. It is never used as an interactive accent.

---

## 9. Typography System

### 9.1 Font roles

| Role | Usage | Properties |
|---|---|---|
| Display sans | Hero titles, screen labels | 800-900 weight, tight tracking, uppercase |
| UI sans | Body, controls, labels | 400-700 weight, sentence or uppercase |
| Mono | Timestamps, codes, receipt values, seek badge, volume counts | Monospace, 600-700 weight |

### 9.2 The four levels (detailed)

**Level 1 - Screen title**
```css
font-size: clamp(40px, 8vw, 64px);
font-weight: 800;
text-transform: uppercase;
letter-spacing: -0.02em;
line-height: 0.95;
```
Used only for: the primary greeting or title of a view (`GOOD NIGHT`, `CHECK-IN`, `SETTINGS`, `ALBUM ARCHIVE`). One per screen maximum.

**Level 2 - Section header**
```css
font-size: 16px;
font-weight: 700;
text-transform: uppercase;
letter-spacing: 0.06em;
line-height: 1.2;
```
Used for: panel headers, group names, section titles, the text inside the `■ emoji LABEL` pattern.

**Level 3 - Field label**
```css
font-size: 11px;
font-weight: 600;
text-transform: uppercase;
letter-spacing: 0.12em;
color: #888888;
line-height: 1.4;
```
Used for: field annotations, tag pill text, metadata sub-labels, pole labels on sliders (`GOOD / SEVERE`), friend code display, version badge text. The wide tracking at this small size is what makes it read as a label.

**Level 4 - Data value**
```css
font-size: 28px;
font-weight: 800;
letter-spacing: -0.01em;
line-height: 1.1;
```
Used for: track titles in Now Playing, large numeric values, username display, dominant content identifiers.

**Body (non-hierarchical content)**
```css
font-size: 16px;
font-weight: 400;
letter-spacing: 0;
line-height: 1.7;
```

**Mono metadata**
```css
font-size: 12px;
font-weight: 600;
text-transform: uppercase;
letter-spacing: 0.04em;
font-family: 'Courier New', Courier, monospace;
font-variant-numeric: tabular-nums;
```

### 9.3 Typographic rules

- Never use font-weight 300 or 100. Ultra-light weights break the visual authority of the system.
- Never introduce a fifth type size. If content needs a size between existing levels, use Level 3 with different color rather than a new size.
- Mono type is always used for timestamps, seek badges, receipt values, and any number that should align vertically with other numbers.
- Level 3 is the most underutilized level. If a screen feels data-light despite having plenty of data, it is missing Level 3 labels.
- Uppercase is used only for: Level 1, Level 2, Level 3, and short button labels. Never for body text.

---

## 10. Spacing and Layout Rhythm

### 10.1 Spacing scale

```
4px  /  8px  /  12px  /  16px  /  24px  /  32px  /  48px
```

No intermediate values. If you need something between 16px and 24px, use 16px and add a visual separator instead.

### 10.2 Component-level spacing

| Context | Value |
|---|---|
| Inner padding on compact chips/tags | 3px 8px |
| Inner padding on standard buttons | 10px 20px |
| Inner padding on cards | 16px |
| Inner padding on panels | 16-24px |
| Gap between elements in a flex row | 8px or 12px |
| Gap between card grid items | 12px or 16px |
| Section-to-section vertical gap | 24px or 32px |
| Tape clip top offset (above card edge) | -9px |
| CTA overflow above dock | -16px |
| Sticker bottom/right breakout | -6px to -8px |

### 10.3 Density guidance

Medium density only. This language loses its punch at low density (feels decorative without purpose) and becomes noise at high density (borders compete with each other).

The redundancy rule (Section 6.1) is the primary tool for managing density. Remove context-redundant information before adjusting spacing.

---

## 11. Motion and Interaction

### 11.1 Motion philosophy

Motion is **short, snappy, and mechanical**. It communicates state change, not delight. Every animation has a clear purpose: press feedback, state transition, entry/exit. No animation exists purely for visual interest.

### 11.2 Press behavior (universal contract)

Every pressable surface in the system follows the same exact behavior:

```css
/* At rest */
.pressable {
  box-shadow: 4px 4px 0 #000;
  transform: translate(0, 0);
  transition: transform 80ms ease-out, box-shadow 80ms ease-out;
}

/* Pressed */
.pressable:active {
  transform: translate(4px, 4px);
  box-shadow: none;
}
```

The element moves by the exact same amount as its shadow offset. This simulates physical depression: as the object moves down-right, its shadow disappears because the object is now at the same level as where the shadow would be.

**Nested elements:** `translate(2px, 2px)` with `2px 2px 0 #000` shadow at rest. Half the offset for a physically smaller/lighter object.

### 11.3 Focus behavior (inputs)

```css
.neo-input:focus {
  background: #F5C518;
  box-shadow: 4px 4px 0 #000;
  transform: translateY(-2px);  /* slight lift on focus */
  outline: none;
}
```

The field activates visually - it does not merely glow. The yellow fill is unavoidable.

### 11.4 State transitions

| Transition | Duration | Easing |
|---|---|---|
| Press / release | 80ms | ease-out |
| Color fill change (active state) | 100ms | ease |
| Toggle half switch | 100ms | ease |
| Tab activation | 120ms | ease-out |
| Modal entry (translate) | 150ms | ease-out |
| Modal exit | 100ms | ease-in |

### 11.5 What never animates

Physical metaphor objects (tape, polaroids) do not have hover or press animations. They are static physical objects. Animating them breaks the metaphor.

The dot matrix background never transitions. The canvas is static.

No animation should use `transform: scale()` as its primary motion. This system uses translation, not scaling.

---

## 12. Form Architecture

### 12.1 Field pattern

Every input field in this system follows the same anatomy:

```
[FIELD LABEL]         ← Level 3 typography, above field
┌──────────────────────────────────────┐
│ Placeholder text                     │  ← white background at rest
└──────────────────────────────────────┘
```

On focus:
```
[FIELD LABEL]
┌──────────────────────────────────────┐ ← 4px 4px shadow appears
│ Cursor aligned to text                │  ← #F5C518 background
└──────────────────────────────────────┘
```

### 12.2 Form panel structure

A complete form section uses:

```
┌────────────────────────────────────────────────────────────┐
│ ■ [EMOJI] SECTION NAME                                      │
│ ────────────────────────────────────────────────────────── │
│                                                             │
│ FIELD ONE LABEL                                             │
│ ┌─────────────────────────────────────────────────────┐    │
│ │ Input content                                        │    │
│ └─────────────────────────────────────────────────────┘    │
│                                                             │
│ FIELD TWO LABEL                                             │
│ [██░░░░░░░░] [3]                                           │
│ SCALE MIN         SCALE MAX                                 │
│                                                             │
└────────────────────────────────────────────────────────────┘
```

The outer panel has a 2px black border and 4px shadow. The section header with its prefix pattern anchors the top. Fields are stacked with 16px gaps. Slider rows use the 10-block track component.

### 12.3 Text area vs legal pad

Standard short inputs use the default input field pattern (white background, 2px black border, yellow on focus).

Long-form text areas (notes, journal entries, lyrics, descriptions) always use the legal pad pattern (yellow surface, blue ruling, red margin). The legal pad is the long-form text area in this system.

---

## 13. Data Visualization

### 13.1 Bar charts use the 10-block track

The exact same component used for vitals input (Section 5.7) is repurposed passively for bar chart display. In display mode, the badge is removed and the blocks simply fill to the data value.

This component reuse creates visual consistency: the user learns one visual language for "a quantity on a 1-10 scale" and encounters it the same way whether they are inputting data or reading it.

### 13.2 Score tiles

For displaying a single metric prominently:

```css
.neo-score-tile {
  border: 2px solid #000000;
  box-shadow: 4px 4px 0 #000000;
  padding: 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  background: [semantic-color]; /* red/yellow/green based on value */
}

.neo-score-value {
  font-size: 48px;
  font-weight: 900;
  line-height: 1;
  letter-spacing: -0.03em;
  font-variant-numeric: tabular-nums;
}

.neo-score-label {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  margin-top: 8px;
}
```

**Color assignment for score tiles:**

| Range | Background | Text |
|---|---|---|
| High / good | `#7CC61F` | `#000000` |
| Medium / neutral | `#F5C518` | `#000000` |
| Low / poor | `#E53935` | `#ffffff` |

### 13.3 Data density rule

No chart should use gradients, soft shadows, rounded corners, or any non-system visual treatment. A bar chart is just a stack of bordered filled squares. A pie equivalent is a segmented bordered circle or a row of colored blocks. The data visualization uses the same grammar as the rest of the UI.

---

## 14. State Patterns

### 14.1 Empty state

```css
.neo-empty {
  border: 2px solid #000000;
  box-shadow: 4px 4px 0 #000000;
  background: #ffffff;
  padding: 32px 24px;
  text-align: center;
}

.neo-empty-primary {
  font-size: 14px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: #000000;
}

.neo-empty-secondary {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: #888888;
  margin-top: 4px;
}
```

**Copy pattern:** two lines. Primary = what's missing (bold, black). Secondary = what to do about it (smaller, gray).

Examples:
- `NOTHING QUEUED` / `DROP A TRACK TO START`
- `NO RESULTS` / `TRY A DIFFERENT SEARCH`
- `PLAYLIST IS EMPTY` / `ADD TRACKS BELOW`
- `CONSOLE STANDBY` / `SELECT A TRACK TO BEGIN`
- `NO LOGS TODAY` / `BE THE FIRST TO CHECK IN`

### 14.2 Loading state

Loading states do not use spinners. They use the same bordered containers with a repeating shimmer or static placeholder blocks.

```css
.neo-skeleton {
  background: linear-gradient(
    90deg,
    #e0e0e0 25%,
    #f0f0f0 50%,
    #e0e0e0 75%
  );
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite linear;
  border: 2px solid #c0c0c0;
  height: [match content height];
}

@keyframes shimmer {
  0%   { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
```

The skeleton block matches the exact dimensions of the content it replaces, maintaining layout stability during loading.

### 14.3 Standby / idle state

When a primary interactive area has no content (Now Playing with nothing loaded), display large faded text at 20% opacity reading the system state (`CONSOLE STANDBY`, `AWAITING INPUT`).

```css
.neo-standby-label {
  font-size: 72px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: -0.03em;
  color: rgba(0, 0, 0, 0.12);
  user-select: none;
  pointer-events: none;
  text-align: left;
  line-height: 0.9;
}
```

The faded large text occupies the empty area without competing with the UI. It communicates system state while confirming the area is not broken.

### 14.4 Connected / active relationship state

When a live connection, partnership, or relationship is active, the entire containing card fills with lime green (see Section 4.5). The color communicates "live" before any text is read.

When disconnected or inactive, the card returns to white fill. No intermediate state exists.

---

## 15. Implementation Tokens

```yaml
color:
  ink: "#000000"
  ink-soft: "#1a1a1a"
  paper: "#FFFFFF"
  paper-warm: "#fafaf7"
  canvas: "#e9e9e9"
  surface-muted: "#F5F5F0"
  gray-200: "#E5E5E5"
  gray-inactive: "#e0e0e0"
  gray-text: "#888888"
  yellow: "#F5C518"
  lime: "#7CC61F"
  amber: "#E8A020"
  red: "#E53935"
  red-light: "#FECACA"
  pad-yellow: "#FDF6A4"
  pad-blue: "rgba(100,149,237,0.4)"
  pad-red: "rgba(220,80,80,0.35)"
  purple: "#A855F7"
  blue: "#3B82F6"
  orange: "#FB923C"
  pink: "#F472B6"

border:
  default: "2px solid #000000"
  soft: "1.5px solid #1a1a1a"
  tape: "1px solid rgba(180,155,80,0.35)"
  dashed: "2px dashed #000000"
  hairline: "1px solid #E5E5E5"
  hairline-dashed: "1px dashed #cccccc"

shadow:
  default: "4px 4px 0px 0px #000000"
  cta: "4px 4px 0px 0px #F5C518"
  danger: "4px 4px 0px 0px #E53935"
  hero: "6px 6px 0px 0px #000000"
  nested: "2px 2px 0px 0px #000000"
  polaroid: "3px 3px 0px 0px #1a1a1a"
  tape: "0 1px 2px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.4)"

radius:
  square: 0
  soft: 4
  pill: 999
  circle: 50%

motion:
  press: "transform 80ms ease-out, box-shadow 80ms ease-out"
  press-shift-default: "translate(4px, 4px)"
  press-shift-nested: "translate(2px, 2px)"
  state: "100ms ease"
  modal-enter: "150ms ease-out"
  modal-exit: "100ms ease-in"

spacing:
  1: 4px
  2: 8px
  3: 12px
  4: 16px
  5: 24px
  6: 32px
  7: 48px

dot-matrix:
  light-bg: "#e9e9e9"
  light-dot: "#b0b0b0"
  dark-bg: "#1a1a1a"
  dark-dot: "rgba(255,255,255,0.08)"
  size: "18px 18px"

tape:
  background: "rgba(230,200,120,0.28)"
  border: "1px solid rgba(180,155,80,0.35)"
  shadow: "0 1px 2px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.4)"
  width: "48px"
  height: "18px"
  top-offset: "-9px"

polaroid:
  bg: "#fafaf7"
  border: "1.5px solid #1a1a1a"
  shadow: "3px 3px 0px 0 #1a1a1a"
  padding: "8px 8px 28px 8px"
  rotation-odd: "-0.8deg"
  rotation-even: "0.6deg"

type:
  l1: "clamp(40px, 8vw, 64px) / 800 / uppercase / -0.02em"
  l2: "16px / 700 / uppercase / 0.06em"
  l3: "11px / 600 / uppercase / 0.12em / #888888"
  l4: "28px / 800 / normal / -0.01em"
  body: "16px / 400 / normal / 0"
  body-sm: "14px / 400 / normal / 0"
  mono: "12px / 600 / uppercase / 0.04em / monospace"
```

---

## 16. Reusable Styling Recipes

### 16.1 Primary CTA (overflowing)
fill `#000`, icon `#fff`, border 2px black, shadow `4px 4px 0 #F5C518`, breaks container by 16px, pressed `translate(4px,4px)` shadow none.

### 16.2 Secondary button
fill `#fff`, text `#000`, border 2px black, shadow `4px 4px 0 #000`, pressed `translate(4px,4px)` shadow none.

### 16.3 Utility button
fill `#F5C518`, text `#000`, border 2px black, shadow `4px 4px 0 #000`, same press.

### 16.4 Danger button
fill `#E53935`, text `#fff`, border 2px black, shadow `4px 4px 0 #000`, same press.

### 16.5 Framed content panel
fill `#fff`, border 2px black, shadow `4px 4px 0 #000`, padding 16-24px.

### 16.6 Focused input
resting fill `#fff`, focused fill `#F5C518`, focused shadow `4px 4px 0 #000`, focused lift `translateY(-2px)`, label Level 3 above.

### 16.7 Polaroid card
fill `#fafaf7`, border `1.5px #1a1a1a`, shadow `3px 3px 0 #1a1a1a`, padding `8px 8px 28px 8px`, rotation `±0.6-0.8deg`, tape clip centered on top.

### 16.8 Translucent tape
`rgba(230,200,120,0.28)` bg, `1px solid rgba(180,155,80,0.35)` border, soft thin shadow, inset top sheen, positioned `top: -9px` center of card.

### 16.9 Legal pad textarea
`#FDF6A4` bg, `repeating-linear-gradient` blue rules at 28px intervals, red margin at 24px left, 2px black border, 4px shadow, `line-height: 28px`.

### 16.10 Section header
`■` prefix + emoji + Level 2 label + 2px rule below.

### 16.11 Binary toggle
80×28px, 2px border, two equal halves, active half `#7CC61F`, inactive `#e0e0e0`, ON/OFF text inside.

### 16.12 Block track (slider / data viz)
10 equal segments with 1px black borders, filled from left, floating `#000` badge with white value at fill edge, pole labels below in Level 3.

### 16.13 Modal
`rgba(0,0,0,0.5)` flat backdrop (no blur), container fill `#fff`, border 2px black, shadow `6px 6px 0 #000`, title strip with 2px bottom border, 32×32 close square.

### 16.14 Radio selection card
Large bordered square, circle indicator top-right (empty = unselected, filled dot = selected), background shifts to theme color when selected, label at bottom in Level 2.

### 16.15 Receipt
Monospaced font, label left + value right in each row, `1px dashed #ccc` row separators, header centered with 2px solid rule below.

### 16.16 Dashed dropzone
`2px dashed #000`, `4px 4px 0 #000` shadow, `#F5C518` fill on drag-over with border switching to solid.

### 16.17 Status card (live connection)
Full-bleed `#7CC61F` fill, 2px black border, 4px black shadow, name in Level 4, status in Level 3, full-width embedded action button inside.

### 16.18 Top-level tab bar
All tabs in one bordered container, single `4px 4px 0 #000` shadow on container, internal `2px solid #000` vertical dividers between tabs, active tab full inverted: `#000` fill `#fff` text.

### 16.19 Context toggle pill
Bordered, `#F5C518` fill, Level 3 text, emoji prefix, 2px shadow, top-right of header, overlapping bottom border slightly.

### 16.20 Danger zone container
Bordered, shadowed, red icon square, red Level 3 label, gray secondary text, danger button pushed to right margin.

---

## 17. Anti-Patterns

### Visual anti-patterns

| Anti-pattern | Why it fails | Correct approach |
|---|---|---|
| Soft blur shadow (`0 4px 12px rgba(0,0,0,0.15)`) | Reads as "floating digital panel," not physical object | `4px 4px 0 #000` only |
| `backdrop-filter: blur()` | Directly contradicts the flat-surface philosophy | Remove entirely |
| Solid yellow tape (`#F5C518` fully opaque) | Sticker, not tape | `rgba(230,200,120,0.28)` |
| Uniform non-rotating polaroid grid | Physical objects don't align perfectly | Alternate `±0.8deg` rotation |
| Hard black border on tape | Tape has no printed edge | `1px solid rgba(...)` only |
| Pure `#ffffff` polaroid surface | Physical paper is warm | `#fafaf7` |
| Multiple rounded corners | Reads as modern app, not editorial physical | `border-radius: 0`, max 4px on specific elements |
| Active state as border weight change | Ambiguous, reads as "selected form element" | Full background fill change |
| Using both yellow and lime on one element | Destroys semantic clarity | One accent per element |
| Three or more accent colors per screen | Reduces semantic signal of each | Maximum two accents |
| Color used decoratively | Corrupts the semantic system | Every color has one exclusive role |
| Card label repeating view context | Visual noise, no information added | Remove context-redundant labels |
| Sort control inside browse filter row | Two different jobs look like one | Separate visually with gap or position |
| Gradient fills | "Digital luxury" aesthetic, not physical | Flat fills only |

### Interaction anti-patterns

| Anti-pattern | Correct approach |
|---|---|
| Hover-only feedback, no press | Every clickable element must have press behavior |
| Animations over 250ms | Hard 250ms maximum |
| Scale-based press (shrink on click) | Translation only (`translate(4px,4px)`) |
| Bouncy overshoot spring | Ease-out with clear endpoint |
| Opacity as sole state signal | Opacity is support; fill change is the signal |
| Tap targets under 44px on mobile | Minimum 44×44px for all interactive elements |
| Physical metaphor objects that hover-animate | Tape and polaroids are static |

### Physical metaphor anti-patterns

| Anti-pattern | Effect |
|---|---|
| Legal pad without matching `line-height` and ruling interval | Text floats off the lines |
| Legal pad text inside the margin line | Breaks the composition rule the metaphor sets up |
| Receipt in proportional font | Loses the thermal printer quality entirely |
| Receipt with centered values | Receipt values are always flush-right, labels flush-left |
| Sticker that doesn't break its parent boundary | Looks like a pill badge, not a sticker |
| Animated physical objects | Destroys the physical metaphor |

### Content anti-patterns

| Anti-pattern | Correct approach |
|---|---|
| Long uppercase paragraphs | Uppercase only for labels and short text |
| Vague status copy ("Something went wrong") | Direct and specific ("LOAD FAILED / CHECK CONNECTION") |
| Inspirational placeholder text | Operational placeholder text (`WRITE YOUR THOUGHTS HERE...`) |
| Redundant contextual labels on cards | Remove if view context already communicates it |
| Unlabeled data (a number with no label) | Every data point needs its Level 3 label |

---

## 18. Design QA Checklist

### Canvas and surface
- [ ] Dot matrix background present on the root canvas (not just a flat color)?
- [ ] Light mode: `#e9e9e9` base with `#b0b0b0` 1px dots at 18px grid?
- [ ] All content panels sit on top of the dot matrix, not floating on a flat color?

### Borders and shadows
- [ ] Every interactive element has `border: 2px solid #000000`?
- [ ] Every interactive element has `box-shadow: 4px 4px 0 0 #000000` at rest?
- [ ] Zero `box-shadow` values with a blur radius anywhere in the neo theme?
- [ ] Zero `backdrop-filter` or `filter: blur()` anywhere in the neo theme?
- [ ] Yellow shadow (`#F5C518`) present on exactly one element per view?
- [ ] Pressed states use `translate(4px, 4px)` and `box-shadow: none`?
- [ ] Nested elements (button-in-card) use `2px 2px 0 #000` shadow?

### Color
- [ ] Yellow (`#F5C518`) used only on: active nav fill, primary CTA shadow, utility button fill?
- [ ] Lime green (`#7CC61F`) used only on: playing card fill, active track row, seek fill, volume fill, toggle active half?
- [ ] Red (`#E53935`) used only on: destructive buttons, danger zone labels?
- [ ] No more than two accent colors visible simultaneously on any single screen?
- [ ] Is any color present that is used for decoration rather than semantic state?

### Active states
- [ ] Active nav item has yellow square fill background (not outline change)?
- [ ] Active/playing card has full-bleed lime green background?
- [ ] Active tab bar item is fully inverted (black fill, white text)?
- [ ] Active input field fills with yellow background?

### Typography
- [ ] All four levels (L1/L2/L3/L4) are present and visually distinct?
- [ ] Level 3 labels present wherever there is field/metadata context?
- [ ] No intermediate type sizes introduced outside the four levels?
- [ ] No body text in uppercase?
- [ ] Timestamps and receipt values use monospace?
- [ ] `font-variant-numeric: tabular-nums` applied to all aligned numeric columns?

### Physical metaphors
- [ ] Tape clips use `rgba(230,200,120,0.28)` background (not solid color)?
- [ ] Tape clips have no hard black border?
- [ ] Tape clips have the inset sheen (`inset 0 1px 0 rgba(255,255,255,0.4)`)?
- [ ] Polaroid cards use `#fafaf7` (not `#ffffff`)?
- [ ] Polaroid cards have fat bottom padding (`8px 8px 28px 8px`)?
- [ ] Polaroid cards alternate rotation (`±0.6-0.8deg`)?
- [ ] Legal pad textarea line-height matches the repeating-linear-gradient interval?
- [ ] Legal pad text starts at left padding that clears the margin line?
- [ ] Receipt values are flush-right, labels flush-left?
- [ ] Receipt uses monospaced font?
- [ ] Physical metaphor objects have no hover or press animations?

### Components
- [ ] Section headers follow `■ emoji LABEL` pattern with 2px rule below?
- [ ] Binary toggles show ON/OFF text inside each half?
- [ ] Block track slider badge is a black square with white monospaced number?
- [ ] Modal backdrop is flat `rgba(0,0,0,0.5)` with no blur?
- [ ] Modal uses 6px shadow (heavier than cards)?
- [ ] Dashed border used exclusively for empty/awaiting states?
- [ ] Tab bar shadow on container, not individual tabs?
- [ ] Danger zone isolated in its own bordered container?

### Redundancy and layout
- [ ] Do any card labels repeat information already conveyed by the view context?
- [ ] Is the sort control separated from browse filter pills?
- [ ] Is there exactly one overflowing primary CTA per view?
- [ ] Is the overflowing CTA breaking its container plane by at least 16px?

### Accessibility
- [ ] All text passes WCAG AA contrast ratio?
- [ ] No body text in uppercase?
- [ ] All interactive touch targets minimum 44×44px?
- [ ] Color meaning supported by text or shape (not color alone)?
- [ ] Reduced motion media query available for press animations?

---

## 19. One-Sentence Design Direction

> Build the interface like a bold printed-object system assembled on a dot-grid surface: 2px black structural outlines, hard-offset shadows with zero blur, mechanical press states that physically sink elements into the surface, translucent tape and warm-paper polaroids as literal physical metaphors, four distinct typographic levels with wide-tracked uppercase labels at the smallest scale, and a three-color semantic accent system where yellow means primary action, lime green means currently active, and red means danger, nothing else.