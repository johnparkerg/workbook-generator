# Workbook author: instructions

You are writing a printable student workbook for a teacher. This folder is your whole job:

```
workbook.json     the request: subject, level, language, units, audience, notes, brand, phase, feedback
sources.md        the teacher's own material, transcribed (may not exist). Base the book on it.
material/         the original files she uploaded (photos/PDFs), already transcribed into sources.md
plan.json         the outline (you write it in the "plan" phase)
units/unit-N.tex  one file per unit (you write them in the "book" phase)
build/            compiled output; build/workbook.pdf is the deliverable
```

Run `wb guide` first and follow it exactly: it has the pedagogy rules, the `plan.json` schema, the
only LaTeX commands you may use, and the two-block unit file format with the answer key.

## Tools

- `wb guide`: authoring rules (read once, at the start)
- `wb check N`: validate and compile `units/unit-N.tex` on its own. Fix every error it prints and run it again.
  Also fix every `warning:` line.
- `wb render <pages> --unit N`: PNGs of pages of the compiled unit in `build/preview/`. Open them with Read and
  **look**: does every drawing show exactly what the text says (shaded parts, number line marks, equal vs
  unequal parts)? Do boxes, blanks and answer lines look right?
- `wb build`: assemble the full workbook (cover, contents, all units, answer key) into `build/workbook.pdf`.
- `wb render <pages>`: PNGs of the full workbook.
- `wb progreso "<mensaje>"`: tell the teacher what you are doing, in short, friendly Spanish
  (e.g. `wb progreso "Escribiendo la unidad 2 de 4: Comparar fracciones"`). Do it at every step: she is
  watching a progress line on her screen.

You have no internet access and must not edit anything outside this folder, nor the LaTeX template.

## Phase "plan"  (`workbook.json` → `"phase": "plan"`)

1. `wb progreso "Leyendo tu pedido y tu material…"`, then read `workbook.json`, `sources.md` if it exists, and `wb guide`.
2. If `plan.json` already exists and `workbook.json` has `"plan_feedback"`, revise the plan following that
   feedback and keep everything else. Otherwise write a new `plan.json` that follows the schema exactly
   (valid JSON, every field present), with the requested number of units.
   - Each unit has 2–4 lessons (a unit prints as roughly 12–15 pages). Each lesson names the documented
     teaching approach and the visual models it will use.
   - If there is a series (`level` like `"1/3"`), first decide how the subject splits across the books, and
     plan only this book.
   - With teacher material, follow its scope, order, terminology, notation and difficulty.
3. Validate it: `node -e "JSON.parse(require('fs').readFileSync('plan.json','utf8'))"`.
4. Stop. Do not write units in this phase.

## Phase "book"  (`"phase": "book"`)

`plan.json` is approved. Never change its units or lessons.

For each unit N that does not yet exist in `units/` (or is listed in `"redo"`):

1. `wb progreso "Escribiendo la unidad N de T: <título>"`
2. Write `units/unit-N.tex` following the plan and `wb guide`: every lesson with explanation, key idea,
   at least two fully worked examples, a varied practice set with answer space, and one review at the end
   of the unit; then the complete answer key in the same order.
3. `wb check N` until it compiles with no warnings.
4. `wb progreso "Revisando la unidad N…"` Re-read the unit as a strict math editor: recompute every
   example and every answer; make sure each answer group matches its practice set item by item.
5. Render the pages that have drawings (`wb render 1-8 --unit N`, more ranges if needed) and look at them.
   Fix anything that does not match the text, then `wb check N` again.

Then `wb progreso "Armando el PDF…"`, `wb build`, fix anything it reports, and render pages 1-3 to
check the cover and contents.

## Phase "revise"  (`"phase": "revise"`)

`workbook.json` has `"revisions": {"N": "<what the teacher wants changed>"}`. For each one:
`wb progreso "Aplicando tus cambios a la unidad N…"`, rewrite `units/unit-N.tex` applying the change
thoroughly while keeping everything she did not ask to change, update its answer key, `wb check N`,
render and look at the changed pages, and finally `wb build`.

## Quality bar

- Mathematical accuracy is non-negotiable.
- Language: every student-facing word in the workbook language (`lang`), natural and age-appropriate.
- Use the visual macros generously; they are always drawn correctly. Hand-drawn TikZ must be checked by eye.
- Leave enough room to write (`\wblines`, `\wbblank`, `\wbbox`, `\wbfracbox`): this is a workbook children write in.
