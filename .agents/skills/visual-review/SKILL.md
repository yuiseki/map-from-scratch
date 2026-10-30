---
name: visual-review
description: How to review a map-from-scratch renderer by opening it and looking, because every check can pass on a map that is squashed, upside down or missing half the world; and how to write verification checks against the geography instead of the renderer's own output. Load it before calling a renderer done, when reviewing examples someone else (or another agent) wrote, and when writing verification checks. The mistakes this procedure found, by category (world wrapping, projection, interaction, picking, popup, markers, clustering, KDE, terrain, 3D extrusion, globe occlusion, cartographic layout), are in map-from-scratch/references/rendering-mistakes.md.
---

# Visual review: what only the screen shows

Two review passes over the examples (2026-10-30) fixed 19 of them; in 13 the
opening view or the first interaction was visibly wrong. `bin/mfs test`
caught none of them, and the bench checks could not: they read pixels at
places derived from the renderer's own output. This skill is the procedure
that found them and the rule for writing checks that would have. What it
found, with how to test and fix each mistake, is in
`.agents/skills/map-from-scratch/references/rendering-mistakes.md`; read the
sections for the request's features before writing the renderer.

## 1. Procedure

Do this for every page, in a real browser, at 1920×1021 and at the bench
viewport (1280×800). Use the dev server (`bin/mfs serve`) so data under
`data/baked` is served.

1. **Look at the opening view before touching it.** Name three features and
   say where they must be relative to each other (Paris north-west of Cairo,
   Tokyo east of Osaka, the Bay inside the coast). Check sizes against known
   ratios: Akita is about 1.6 times taller than wide; Luxembourg must fit an
   800 px window at the opening zoom.
2. **Read the console and the network list.** A Range read that answered 200,
   a 404 on data, a wasm MIME error: each is a bug even when the picture looks
   fine.
3. **Operate every control.** Drag in both axes and check that the content
   follows the pointer, wheel in and out, press every button and select,
   hover something with a tooltip. After any change to a camera, re-check the
   drag directions.
4. **Push the view to the edges of the data.** Zoom out to the whole world
   (the antimeridian, the poles, the edge of a detail box), rotate a globe so
   a continent sits on the rim, tilt a 3D view to the steepest and the
   flattest pitch.
5. **Compare the legend, the labels and the data.** Count the items drawn and
   the items listed.
6. **Before fixing, rule out the view.** Change the camera and look again: a
   brown "rectangle" around Fuji in example 17 was a contour band seen in
   perspective, and a staircase in d3-016 is a limitation REQUEST.md already
   states. Read REQUEST.md before calling something a bug.
7. **After fixing, run the page with `?bench` in the browser** (define
   `window.__mfsEmit` in an init script to collect the reports) as well as
   `bin/mfs test`, and measure size and frame time against the budgets.

## 2. Checks that test the geography

The fixes above were invisible to the checks because each check asked the
renderer where something was and then looked there. Write checks against
facts the renderer does not compute:

- ratios and orderings from the ground (width over height of a known region,
  east-west order of two cities, a peak above its base);
- the count of drawn items against the count in the data;
- the absence of land colour at a known sea point near the rim, the
  antimeridian, or the edge of a detail box;
- the content moving with a synthetic drag in both axes.

Read a few pixels, not one: a check of the single pixel under a projected
vertex of a 1.2 px line read the glow beside it at 1920x1021 (openglobus 062,
before and after its fix). Search a 5x5 neighbourhood for the colour.

When a fix moves things on the screen, a check that fails afterwards may have
been testing the bug. Recompute its coordinates from geography, say so in
the commit, and do not loosen its tolerance.
