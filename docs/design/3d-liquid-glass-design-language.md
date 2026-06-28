# Liquid Glass Design Language for Tarab

Liquid Glass in Tarab is a **navigation-and-controls material**, not a general surface style. It should sit above content, stay visually quiet at rest, become more expressive during interaction, and preserve a clear hierarchy between controls and the music content underneath. In Apple’s guidance, Liquid Glass is best reserved for the floating navigation layer, should not be used everywhere, and should avoid glass-on-glass stacking. ([Apple Developer][1])

## Core Principle

**Glass belongs on the control layer, not the content layer.**

In Tarab, Liquid Glass should help elevate high-touch controls above album art, wallpaper, blurred artwork, and other background visuals. It should never compete with track lists, lyrics, or primary reading surfaces. Apple explicitly recommends keeping Liquid Glass in the navigation layer, avoiding it in content-heavy regions, and avoiding stacked glass materials. ([Apple Developer][1])

## Material Rules

* Use **Regular** Liquid Glass by default.
* Use **Clear** only over obviously media-rich surfaces, such as album art or immersive now-playing backgrounds, and only when legibility is protected with dimming or other separation.
* Never mix **Regular** and **Clear** in the same local control group.
* Keep the resting state restrained. The material should become more optical on hover, press, activation, expansion, or morph transitions.
* Avoid glass-on-glass. If an element sits on top of a glass surface, the top element should usually use fill, transparency, vibrancy, or a non-glass treatment instead of another full glass shell. Apple’s guidance is explicit on Regular vs Clear, their different use cases, and the need to avoid mixing or stacking them casually. ([Apple Developer][1])

## Allowed Contexts, Do Use For

The Liquid Glass effect is reserved for **interactive, floating, or transitional control surfaces** in Tarab:

* [x] **Active tab pill**
  Use for the currently selected top-level section. The pill should morph between tabs rather than appear as disconnected states.

* [x] **Segmented controls**
  Use for compact, high-touch toggles where the active segment is the main visual emphasis.

* [x] **Playback controls**
  Use for the core play/pause/skip cluster, transport buttons, and other primary playback actions, especially during hover, press, or active states.

* [x] **Floating toolbar controls**
  Use for compact toolbars or grouped control clusters that hover above content. Apple’s updated toolbar language explicitly uses floating Liquid Glass surfaces for this kind of control grouping. ([Apple Developer][2])

* [x] **Search control**
  Use for the search trigger, expanded search field, or search-related floating control shell. Apple’s current search patterns include toolbar search that can minimize to a button and expand when tapped. ([Apple Developer][2])

* [x] **Context menus, popovers, dialogs, and transient presentations**
  Use for floating presentations that emerge from a control. In Tarab, these should feel visually linked to the originating button, not like unrelated panels. Apple explicitly recommends presentations that flow or morph from the control that invoked them. ([Apple Developer][1])

* [x] **Compact now-playing accessory surface**
  Use only for a small floating mini-player or accessory control surface, not for the main now-playing content region.

## Conditionally Allowed Contexts, Use Only If They Behave Like Navigation

These are not default Tarab uses, but they can be allowed if they truly function as floating navigation and remain visually restrained:

* [ ] **Floating sidebar or top-level navigation rail**
  Only allow if it behaves as a lightweight floating navigation element above content, not as a heavy structural panel. Apple does allow larger navigational elements like floating sidebars and tab bars to participate in the Liquid Glass system, but that does **not** mean every large app panel should become glass. In Tarab, default to non-glass unless the sidebar is clearly acting like a floating navigation layer. ([Apple Developer][1])

## Prohibited Contexts, Do NOT Use For

To preserve hierarchy, readability, and performance, Liquid Glass must **not** be used on large structural surfaces or repeating content blocks:

* [ ] **Track rows**
  Never use on individual song rows, queue items, or list entries.

* [ ] **Album grids**
  Never use on album covers, album tiles, or grid containers.

* [ ] **Large panels**
  Do not use on major structural containers, full side panels, or main app shells unless they qualify as a true floating navigation element under the conditional rule above.

* [ ] **Content cards**
  Do not use on recommendation cards, playlist cards, artist cards, or other repeated content containers.

* [ ] **Lyrics surfaces**
  Never use as the primary lyrics reading background.

* [ ] **List backgrounds**
  Never use behind long scrollable content areas such as library lists, search results, or queue views.

* [ ] **Main now-playing content surface**
  Do not turn the entire now-playing view into Liquid Glass. Use it only on the compact accessory and control layer, not the main artwork, metadata, or lyrics surface.

Apple’s guidance is direct here: putting Liquid Glass into table-like or content-heavy regions competes with the content and muddies the hierarchy. ([Apple Developer][1])

## Interaction Behavior

In Tarab, Liquid Glass should **materialize through interaction**:

* rest quietly when idle
* lift or brighten slightly on hover
* flex and energize on press
* remain stronger when active or selected
* morph between related controls and presentations

Apple specifically describes Liquid Glass as becoming more alive on touch, flexing with interaction, and morphing between related controls and menus while preserving the feeling of a single floating plane. ([Apple Developer][1])

## Tarab-Specific Summary

For Tarab, think of Liquid Glass as the material for:

* **what you touch**
* **what floats**
* **what transitions**
* **what controls playback or navigation**

Not for:

* **what you read**
* **what repeats**
* **what structures the whole screen**
* **what carries the bulk of the music content**
