# Day 18 implementation prompt — NULL

Create an original, from-scratch map for 30DayMapChallenge 2026 Day 18, “NULL”.

## Map brief

Show central Tokyo as a 250 m census mesh map of the number of women aged 75 and over in 2020. Make four spatial states impossible to confuse: an exact zero, a published positive count, a suppressed value (`*`), and a mesh with no source row. Use a compact fixed study window in Tokyo’s 23 wards with actual examples of all four states. Render missing source rows as geographic holes in the expected mesh lattice; do not turn them into zero. Render suppressed values as a distinct hatch or symbol; do not infer their count. Add a legend, a clear 2020/250 m metric label, a visible source credit, and a short explanation that an unrecorded mesh indicates no census population record, while `*` is statistical confidentiality suppression rather than zero.

## Source and truthful handling

- Use the local `hf:estat-census-mesh-250m-2020` table `T001142` (JGD2011), prefecture 13; field `T001142024` is 「７５歳以上人口　女」 and `KEY_CODE` identifies 250 m JIS mesh cells.
- Preserve string values. `*` means suppressed. Keep literal `0` separate from positive numeric counts. A mesh code absent from the prefecture table is not a zero observation; show it as a no-row hole within the explicitly bounded display lattice.
- Use the dataset README and Statistics Bureau / e-Stat materials as evidence for these semantics. Include attribution: 「政府統計の総合窓口(e-Stat)『令和2年国勢調査』(総務省統計局)を加工して作成」 and CC BY 4.0 in the page and spec.
- Keep the AOI small enough to read the 250 m cells, but select it from measured data so every state is visibly represented. Report the AOI and counts by state. Do not use image generation, a mapping SDK, or fabricated sample data in the final map.

Initial capped source survey selected the Tokyo central AOI `139.65≤lon≤139.78`, `35.62≤lat≤35.72`. Its expected lattice has 2,016 cells; the women-75+ field has 1,716 positive values, 27 exact zeroes, 49 suppressed values, and 224 absent mesh rows. Reconfirm these counts in the reproducible bake output.

## Engineering requirements

- Follow TDD: first add unit tests for mesh-code decoding/lattice generation, classification of `0`/positive/`*`/missing, and rejection of malformed values; confirm the relevant tests fail before implementation.
- Implement a dedicated, dependency-free Canvas 2D renderer with pan/zoom and hover inspection. Clearly differentiate the four states by both color and texture/outline so the map remains legible.
- Add `spec.yaml`, bake script, browser benchmark, reproducible output and statistics, visual browser verification, README/renderer docs if this example family requires them, and update the day row in `examples/30DayMapChallenge/2026/TODO.md`.
- Run the project’s relevant and full test/type-check suites. Perform at least three browser benchmark runs and retain the screenshot and measurements.
- All commands that read/query/bake/test/benchmark real data must be run with:
  `systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -p CPUQuota=400% -- <command>`.
- Keep the implementation reviewable and leave commit/push to the parent agent.
