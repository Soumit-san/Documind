---
name: Neo-Brutalist SaaS
colors:
  surface: '#15130d'
  surface-dim: '#15130d'
  surface-bright: '#3c3931'
  surface-container-lowest: '#100e08'
  surface-container-low: '#1e1b15'
  surface-container: '#221f19'
  surface-container-high: '#2d2a22'
  surface-container-highest: '#38342d'
  on-surface: '#e8e2d6'
  on-surface-variant: '#cfc6b2'
  inverse-surface: '#e8e2d6'
  inverse-on-surface: '#333029'
  outline: '#98907e'
  outline-variant: '#4c4637'
  surface-tint: '#e1c563'
  primary: '#ffffff'
  on-primary: '#3b2f00'
  primary-container: '#ffe17c'
  on-primary-container: '#786202'
  inverse-primary: '#715c00'
  secondary: '#bbcac6'
  on-secondary: '#263330'
  secondary-container: '#3c4a47'
  on-secondary-container: '#a9b8b4'
  tertiary: '#ffffff'
  on-tertiary: '#00363b'
  tertiary-container: '#91f1fd'
  on-tertiary-container: '#006f79'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#ffe17c'
  primary-fixed-dim: '#e1c563'
  on-primary-fixed: '#231b00'
  on-primary-fixed-variant: '#554500'
  secondary-fixed: '#d7e6e2'
  secondary-fixed-dim: '#bbcac6'
  on-secondary-fixed: '#111e1c'
  on-secondary-fixed-variant: '#3c4a47'
  tertiary-fixed: '#91f1fd'
  tertiary-fixed-dim: '#74d5e1'
  on-tertiary-fixed: '#001f23'
  on-tertiary-fixed-variant: '#004f56'
  background: '#15130d'
  on-background: '#e8e2d6'
  surface-variant: '#38342d'
typography:
  h1:
    fontFamily: Cabinet Grotesk
    fontSize: 64px
    fontWeight: '800'
    lineHeight: '1.1'
    letterSpacing: -0.05em
  h2:
    fontFamily: Cabinet Grotesk
    fontSize: 48px
    fontWeight: '800'
    lineHeight: '1.1'
    letterSpacing: -0.04em
  h3:
    fontFamily: Cabinet Grotesk
    fontSize: 32px
    fontWeight: '800'
    lineHeight: '1.2'
    letterSpacing: -0.03em
  body-lg:
    fontFamily: Satoshi
    fontSize: 18px
    fontWeight: '500'
    lineHeight: '1.6'
  body-md:
    fontFamily: Satoshi
    fontSize: 16px
    fontWeight: '500'
    lineHeight: '1.6'
  label:
    fontFamily: Satoshi
    fontSize: 14px
    fontWeight: '700'
    lineHeight: '1.4'
spacing:
  base: 8px
  xs: 4px
  sm: 12px
  md: 24px
  lg: 48px
  xl: 64px
  gutter: 24px
---

## Brand & Style

This design system leverages a **Neo-Brutalist** aesthetic to differentiate within the SaaS market. It rejects the standard "soft and safe" corporate look in favor of raw, high-contrast, and geometric layouts. The personality is unapologetic, energetic, and highly functional, designed for forward-thinking technical teams who value clarity and bold structural integrity. The emotional response is one of confidence and precision, achieved through aggressive borders and a vibrant, limited color palette.

## Colors

The palette is anchored by a Charcoal background to provide a deep, high-contrast canvas for the vibrant Yellow primary and Sage accents.

- **Primary (#ffe17c):** Used for key calls-to-action, hero sections, and highlighted states. Always paired with a 32px radial dot pattern at 10% opacity for texture.
- **Background (#171e19):** The structural base of the application.
- **Accent (#b7c6c2):** Reserved for secondary UI elements, status indicators, or subtle metadata containers.
- **UI/Text:** High-contrast White surfaces and Black text/borders ensure maximum readability and a "printed" feel.

## Typography

Typography is a central pillar of the Neo-Brutalist identity. Headings utilize **Cabinet Grotesk** at Extrabold weights with tight tracking to create a massive, architectural feel. For body copy, **Satoshi** provides a modern, legible contrast with its geometric construction and Medium (500) weight. 

Instructions:
- All headings must use `tracking-tighter`.
- Maintain a strict hierarchy where labels are often uppercase and bold to match the "technical document" aesthetic.
- Avoid italicization unless strictly necessary for semantic emphasis.

## Layout & Spacing

This design system uses a **Fixed Grid** philosophy. The content resides within defined containers that respect 2px solid black borders. Layouts should feel modular, like a series of blocks stacked together.

- **Grid:** 12-column system with 24px gutters.
- **Rhythm:** All margins and paddings must be multiples of 8px.
- **Containers:** Large containers use 8px hard shadows, while internal modules use 4px hard shadows.
- **Yellow Surfaces:** Any container using the Primary Yellow background must include the 32px x 32px radial dot pattern (opacity 10%).

## Elevation & Depth

Depth is not achieved through light and shadow simulation, but through **Hard Shadows** and **Translation Transitions**. There are no blurs or gradients in the elevation model.

- **Standard Elevation:** 2px solid black border with a `4px 4px 0px 0px #000000` box-shadow.
- **High Elevation:** 2px solid black border with a `8px 8px 0px 0px #000000` box-shadow (used for modal containers and large cards).
- **Interactive Depth:** When an element is hovered or pressed, it should physically move towards the shadow. Use `transform: translate(4px, 4px)` and reduce the shadow to 0 to simulate the element being "pushed" into the page.

## Shapes

The shape language is strictly **Geometric and Sharp**. 
- All corners (buttons, cards, inputs, dropdowns) must have a `0px` border-radius.
- Borders are consistently `2px solid #000000`.
- Icons should be stroke-based with square caps and joins to match the structural rigidity of the UI components.

## Components

### Buttons
- **Primary:** Yellow background, 2px black border, black text, 4px hard shadow.
- **Hover State:** `transform: translate(2px, 2px)` with shadow reduced to 2px, or `translate(4px, 4px)` with 0 shadow.
- **Shape:** Rectangular, no rounding.

### Cards
- **Surface:** White or Sage background. 
- **Shadow:** 8px hard shadow for main layout cards; 4px for nested cards.
- **Header:** Often separated by a 2px horizontal black line.

### Input Fields
- **Style:** White background, 2px solid black border, 0px radius.
- **Focus:** Change background to Yellow or add a 4px hard shadow to indicate active state.

### Chips & Tags
- **Style:** Sage background with 2px black border. Small, all-caps Satoshi Bold text.

### Checkboxes/Radios
- **Style:** Square (0px radius), 2px solid black border. When checked, the interior fills with the primary yellow color and a black "X" or square dot.

### Dot Pattern Texture
- **Usage:** Apply a `radial-gradient(#000000 10%, transparent 10%)` with a `background-size: 32px 32px` to all large yellow surfaces at 10% opacity.