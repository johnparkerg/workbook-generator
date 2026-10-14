# Example: Fracciones · Nivel 1 de 3 · es_MX · Miss Merab

Generated with:

```sh
node src/cli.js --subject "Matemáticas / Fracciones" --level "1 of 3" --lang es_MX --brand miss-merab
```

Model `typesafe/jev-router`, ~13 min, ~$0.30. Audience inferred by the model: 3.º de primaria (8–9 years).

- [`fracciones-nivel-1.pdf`](fracciones-nivel-1.pdf): the 60-page workbook
- [`plan.json`](plan.json): the series split and unit/lesson outline, with the teaching approach for each lesson
- [`units/`](units): each unit's LaTeX and answer key exactly as saved by the generator

To rebuild the PDF from these files without any model calls:

```sh
mkdir -p output/demo && cp -r examples/fracciones-nivel-1/{plan.json,units} output/demo/
node src/cli.js --subject "Matemáticas / Fracciones" --level "1 of 3" --out output/demo
```
