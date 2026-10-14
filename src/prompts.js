// Prompts del generador. Se escriben en inglés (los modelos siguen mejor las
// instrucciones así); el contenido del cuadernillo sale en el idioma pedido.

const PEDAGOGY = `Pedagogy rules (strict):
- Use only explanation strategies that are well documented and widely used in mathematics/subject education for this age group — e.g. concrete–pictorial–abstract (Bruner; Singapore math), fraction strips/bars, area (pie and rectangle) models, number lines, equal-sharing story problems (Cognitively Guided Instruction), bar models, worked examples followed by faded practice, retrieval practice and spaced review.
- Do NOT invent new methods, mnemonics, rules or tricks that are not in common classroom use. If a tip is a known classroom device (e.g. "denominator = how many equal parts"), it is fine.
- Never cite papers, books or authors in the student text.
- Age-appropriate language: short sentences, concrete everyday contexts (food, sharing, sports, school), friendly second person, no condescension.
- Mathematical accuracy is non-negotiable. Every number, example and answer must be correct.`;

export function planMessages({ subject, level, lang, units, audience, notes }) {
  const series = level.of
    ? `This is book ${level.level} of a ${level.of}-book series on this subject. First sketch how the whole subject splits across the ${level.of} books (from introductory to advanced), then plan ONLY the content of book ${level.level}, so it neither repeats an earlier book nor jumps ahead to a later one.`
    : `Difficulty level: ${level.level}.`;
  return [
    {
      role: 'system',
      content: `You are an expert curriculum designer and textbook author who writes student workbooks.\n\n${PEDAGOGY}`,
    },
    {
      role: 'user',
      content: `Plan a student workbook.

Subject: ${subject}
${series}
Language of the workbook: ${lang.name}. Write every student-facing string in this language, using regional conventions (vocabulary, decimal marks, examples, names, currency) of ${lang.code}.${lang.code === 'es_MX' ? ' Align with the SEP (Mexico) curriculum where it makes sense.' : ''}
Number of units: ${units}
Audience: ${audience || 'infer the most appropriate age and school grade for this subject and level, and state it'}.
${notes ? `Author notes: ${notes}\n` : ''}
Each unit will have 2–4 lessons. Each lesson has an explanation, a key-idea box, worked examples, and a practice set; each unit ends with a review quiz. Visual models (fraction bars, circles, grids, number lines, or simple TikZ diagrams) should be used wherever they help understanding.

Respond with ONLY a JSON object, no prose, in this exact shape:
{
  "title": "workbook title (short, in the workbook language)",
  "subtitle": "one line describing what the student will learn",
  "audience": { "age": "e.g. 8–9", "grade": "school grade in the local system", "rationale": "one sentence (English)" },
  "series": [ { "book": 1, "focus": "what that book covers (English)" } ],
  "intro": { "title": "heading for a short welcome page", "text": "3–5 short sentences addressed to the student, plain text, no LaTeX" },
  "units": [
    {
      "title": "unit title, without \"Unit N:\" (numbering is added automatically)",
      "summary": "1–2 sentences addressed to the student, plain text",
      "objectives": ["what the student will be able to do"],
      "lessons": [
        { "title": "lesson title, without \"Lesson N:\"", "goal": "what is learned (English)", "approach": "the documented teaching approach used (English)", "visuals": "which visual models to use (English)" }
      ],
      "review_focus": "what the unit review assesses (English)"
    }
  ]
}`,
    },
  ];
}

export const LATEX_VOCAB = String.raw`Write the unit body in LaTeX using ONLY standard LaTeX, amsmath, TikZ, enumerate/itemize, tabular/array, center, multicols, and these workbook commands (already defined — do NOT define or redefine anything, no \usepackage, no \documentclass, no \begin{document}):

\wbunit{Unit title}{Unit summary for the student}   — FIRST line, exactly once.
\section{Lesson title}                              — one per lesson. Numbered automatically.
\subsection{...}                                    — optional sub-heading inside a lesson.
\begin{wbidea}[optional short title] ... \end{wbidea}        — key idea / definition box.
\begin{wbexample}[optional short title] ... \end{wbexample}  — worked example with the full solution shown step by step.
\begin{wbtip}[optional short title] ... \end{wbtip}          — a short tip or common-mistake warning.
\begin{wbpractice}[optional title] \begin{enumerate} \item ... \end{enumerate} \end{wbpractice}
      — practice set. Auto-titled "Practice <unit>.<k>", k = 1,2,3… in order of appearance within the unit.
\begin{wbreview} \begin{enumerate} \item ... \end{enumerate} \end{wbreview}
      — the unit review quiz. Exactly once, at the very end of the unit.

Space for student answers (use generously — this is a workbook children write in):
\wblines{n}        n ruled lines for written answers (put it on its own line after the question)
\wbblank           a short blank to fill in inline; \wbblank[4cm] for a longer one
\wbbox[3cm]        a dashed box to draw or calculate in (height optional)
\wbfracbox         an empty fraction (two boxes) for the student to fill in

Fraction visuals (n parts shaded out of d equal parts; use n=0 for "colour it yourself"):
\wbfracbar[width]{n}{d}          horizontal bar, default width 6cm
\wbfraccircle[radius]{n}{d}      circle/pie, default radius 1.1cm
\wbfracgrid{n}{rows}{cols}       rectangle grid, first n cells shaded
\wbnumberline[width]{d}{wholes}{marks}   number line 0..wholes split in d parts per whole; marks = comma list of numerators to dot and label (e.g. {3,5}), or {} for none. Put it on its own line.
For other diagrams, write a small self-contained \begin{tikzpicture}...\end{tikzpicture}. Colours available: wbprimary, wbsecondary, wbaccent, wbpaper (and mixes like wbaccent!30).

Math: always in $...$ or \[...\]. Fractions with \frac{a}{b}; mixed numbers like $1\frac{1}{2}$. Never write fractions as a/b in text.
Plain text: escape % & # _ $ as \% \& \# \_ \$. Use real UTF-8 characters for accents (á, ñ, ¿, ¡). Use \textbf / \emph for emphasis. No Markdown.`;

const OUTPUT_FORMAT = String.raw`Output format — exactly two blocks, nothing before or after, no code fences:
%%% BEGIN UNIT
...the unit LaTeX...
%%% END UNIT
%%% BEGIN ANSWERS
...the answer key LaTeX...
%%% END ANSWERS

The answer key covers EVERY practice item and EVERY review item, in order, grouped like this:
\wbanswers{\wbLPractice\ <unit>.<k>}
\begin{enumerate} \item answer \item answer ... \end{enumerate}
...one group per practice set, then:
\wbanswers{\wbLReview}
\begin{enumerate} ... \end{enumerate}
Answers are short: the result, plus one brief line of reasoning when useful. For open/drawing items describe what a correct answer looks like. The answer key is printed in two narrow columns: keep visuals out of it except small ones (e.g. \wbfracbar[2.5cm]{..}{..}).`;

export function unitMessages({ plan, index, lang, subject, level }) {
  const unit = plan.units[index];
  const n = index + 1;
  const context = plan.units
    .map((u, i) => `Unit ${i + 1}: ${u.title}${i === index ? '   <-- WRITE THIS ONE' : ''}`)
    .join('\n');
  return [
    {
      role: 'system',
      content: `You are an expert textbook author and LaTeX typesetter writing one unit of a student workbook.\n\n${PEDAGOGY}\n\n${LATEX_VOCAB}\n\n${OUTPUT_FORMAT}`,
    },
    {
      role: 'user',
      content: `Workbook: "${plan.title}" — ${plan.subtitle}
Subject: ${subject}${level.of ? ` (book ${level.level} of ${level.of})` : ''}
Audience: age ${plan.audience?.age}, ${plan.audience?.grade}
Language: ${lang.name}. Every student-facing word must be in this language.

All units of this book:
${context}

Write unit ${n} in full, following this plan:
${JSON.stringify(unit, null, 2)}

Requirements:
- Start with \\wbunit{${unit.title}}{<the summary>}.
- One \\section per planned lesson, in order. Each lesson: a clear explanation built on the planned approach (concrete situation → picture → symbols), at least one wbidea box, at least two worked examples (wbexample) with every step shown, optionally a wbtip with a common mistake, then a wbpractice set of 5–8 varied items (identify, represent/colour, complete, compare, word problem, explain-your-thinking), progressing from easy to harder. Use the visual macros often.
- Earlier units of this book may be referenced; do not teach content from later units.
- End with one wbreview of 6–10 items covering the whole unit.
- Give every item enough answer space (\\wblines, \\wbblank, \\wbbox, \\wbfracbox).
- Then the complete answer key. Double-check every answer.`,
    },
  ];
}

export function reviewMessages({ output, lang, plan }) {
  return [
    {
      role: 'system',
      content: `You are a meticulous mathematics/subject editor and LaTeX proofreader for children's workbooks (audience: age ${plan.audience?.age}, ${plan.audience?.grade}; language ${lang.name}).\n\n${PEDAGOGY}\n\n${LATEX_VOCAB}\n\n${OUTPUT_FORMAT}`,
    },
    {
      role: 'user',
      content: `Check this unit and its answer key carefully:
1. Every example, statement and answer is mathematically correct.
2. Every shaded visual matches the fraction or number the text says it shows.
3. The answer key has exactly one answer per practice/review item, in the same order, and the practice numbers match the order of the wbpractice sets.
4. Language is correct, natural ${lang.name}, age appropriate; no invented methods.
5. Only the allowed commands are used.

If everything is correct, reply with exactly: NO_CHANGES
Otherwise reply with the full corrected output in the required two-block format (not a diff).

${output}`,
    },
  ];
}

export function reviseMessages({ output, feedback, lang, plan, index }) {
  const unit = plan.units[index];
  return [
    {
      role: 'system',
      content: `You are an expert textbook author revising one unit of a student workbook (audience: age ${plan.audience?.age}, ${plan.audience?.grade}; language ${lang.name}) according to the teacher's feedback.\n\n${PEDAGOGY}\n\n${LATEX_VOCAB}\n\n${OUTPUT_FORMAT}`,
    },
    {
      role: 'user',
      content: `The teacher reviewed unit ${index + 1} ("${unit.title}") and asked for this change:

"""${feedback}"""

Apply the change thoroughly but keep everything the teacher did not ask to change. Keep the same structure rules (one \\wbunit, lessons as \\section, wbpractice sets, one wbreview at the end) and update the answer key so it matches every item exactly. Double-check all math.

Return the full revised output in the two-block format.

${output}`,
    },
  ];
}

export function fixMessages({ output, errors }) {
  return [
    {
      role: 'system',
      content: `You fix LaTeX compile errors in a workbook unit without changing its content.\n\n${LATEX_VOCAB}\n\n${OUTPUT_FORMAT}`,
    },
    {
      role: 'user',
      content: `This unit failed to compile with xelatex. Errors (line numbers refer to a test document that wraps the unit, so use the quoted source lines to locate the problem):

${errors}

Fix every cause of the errors, keep everything else identical, and return the full output in the two-block format.

${output}`,
    },
  ];
}

// "Unidad 2: Comparar" → "Comparar". La numeración la pone wb.sty.
const NUMBERED = /^\s*(?:unidad|unit|unidade|lecci[oó]n|lesson|li[cç][aã]o|tema)\s*\d+\s*[:.\-–—]\s*/i;
export const stripNumber = (title = '') => String(title).replace(NUMBERED, '');

export function normalizePlan(plan) {
  for (const u of plan.units) {
    u.title = stripNumber(u.title);
    for (const l of u.lessons || []) l.title = stripNumber(l.title);
  }
  return plan;
}

/** Quita "Unidad N:" / "Lección N:" de \wbunit y \section en el LaTeX de una unidad. */
export function normalizeUnit({ latex, answers }) {
  const fix = (cmd) => new RegExp(`(\\\\${cmd}\\*?\\{)\\s*(?:unidad|unit|unidade|lecci[oó]n|lesson|li[cç][aã]o|tema)\\s*\\d+\\s*[:.\\-–—]\\s*`, 'gi');
  return { latex: latex.replace(fix('wbunit'), '$1').replace(fix('section'), '$1'), answers };
}

/** Separa la respuesta del modelo en { latex, answers }. Lanza si falta algo. */
export function parseUnitOutput(text) {
  const clean = text.replace(/^```[a-z]*\s*$/gim, '');
  const grab = (name) => {
    const m = clean.match(new RegExp(`%%%\\s*BEGIN ${name}\\s*\\n([\\s\\S]*?)\\n\\s*%%%\\s*END ${name}`));
    return m ? m[1].trim() : null;
  };
  const latex = grab('UNIT');
  const answers = grab('ANSWERS');
  if (!latex || !answers) throw new Error('Model output is missing the %%% BEGIN UNIT / ANSWERS blocks');
  const forbidden = /\\(documentclass|usepackage|begin\{document\}|end\{document\}|newcommand|renewcommand|def\\)/;
  if (forbidden.test(latex) || forbidden.test(answers)) {
    throw new Error('Model output contains preamble commands (\\documentclass, \\usepackage, \\newcommand…)');
  }
  if ((latex.match(/\\wbunit\{/g) || []).length !== 1) throw new Error('Unit must contain exactly one \\wbunit');
  return normalizeUnit({ latex, answers });
}

export function formatOutput({ latex, answers }) {
  return `%%% BEGIN UNIT\n${latex}\n%%% END UNIT\n%%% BEGIN ANSWERS\n${answers}\n%%% END ANSWERS`;
}

/** Extrae el primer objeto JSON de la respuesta (tolera ```json …```). */
export function parseJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('No JSON object in model response');
  return JSON.parse(text.slice(start, end + 1));
}
