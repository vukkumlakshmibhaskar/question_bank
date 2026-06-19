Section-aware extraction test run
Job ID: 5e57c026-203b-4cd4-944d-7d87b0b9f8d1
Source PDF: C:\Users\lakshmibhaskar.v\Downloads\71 S 211 A E.pdf

Result summary:
- Parser completed with 56 extracted rows.
- Parser export saved: parser-export\SET_A.xlsx and parser-export\SET_A.json.
- QBank Extraction Review updated: reviewId 25.
- Vision instruction detection found:
  - Section A: questions 1-28, HIGH confidence.
  - Section B: questions 29-44, HIGH confidence.
- QBank section workbook saved: qbank-section-workbook-review-25-with-vision.xlsx.
- Workbook sheets:
  - Sections: 2 rows.
  - Questions: 56 rows from parser output.
  - Question Items: 95 rows.
  - Validation: 8 low-confidence rows.

Important finding:
The parser output still treats some subparts/OR/parser-number anomalies as separate question rows.
The normalizer now keeps the section map correct and marks conflicting rows as LOW_SECTION_CONFIDENCE for reviewer correction instead of silently approving them.
Next rule needed: canonical question grouping so printed Q28 subparts and OR choices move into Question Items, while Questions becomes one row per printed question.
