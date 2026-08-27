# Transelec

Transelec is a Campo Digital bounded product context.

The repository path retains the historical technical spelling
`products/transelect/`. The stakeholder/project name is **Transelec**.

## Current status

Source Contract V1 is under implementation from the real operational workbook
supplied by the stakeholder.

The first source contract is intentionally limited to the current `Resumen`
worksheet. It establishes source structure and safe parsing before defining
canonical database entities or workflow rules.

## Source boundary

Expected external source location:

`03_Proyecto_Transelec/02_Datos_Entrada/`

Source files remain outside Git.

## Current implementation

`transelec_ingestion.xlsx_contract`:

- requires the `Resumen` worksheet;
- validates the expected column schema by position;
- distinguishes the two source columns both named `Carpeta`;
- preserves source row numbers;
- skips rows without PMF;
- treats `ID_Predo_Unico` only as a provisional source-derived predio identity;
- validates the A:AD business-table boundary and its blank AE separator;
- ignores worksheet-local auxiliary content from AF onward.

No PMF-level status aggregation rule or canonical persistence identity has yet
been inferred.
