export const instructionsForInformationTypes = `# Information Types and Reliability Assessment

## Information Classification
Documents in the RAG system are classified as "Stock Information" (long-term value) and "Flow Information" (time-limited value).

## Identifying Flow Information
Treat a document as "Flow Information" if it matches any of the following criteria:

1. Path or title contains date/time notation:
   - Year/month/day: 2025/05/01, 2025-05-01, 20250501, etc.
   - Year/month: 2025/05, 2025-05, etc.
   - Quarter: 2025Q1, 2025 Q2, etc.
   - Half-year: 2025H1, 2025-H2, etc.

2. Path or title contains temporal concept words:
   - English: meeting, minutes, log, diary, weekly, monthly, report, session
   - Japanese: 会議, 議事録, 日報, 週報, 月報, レポート, 定例
   - Equivalent words in other languages

3. Content that clearly indicates meeting records or time-limited information

Documents that don't match the above criteria should be treated as "Stock Information."

## Efficient Reliability Assessment
- **Flow Information**: Prioritize those with newer creation dates or explicitly mentioned dates
- **Stock Information**: Prioritize those with newer update dates
- **Priority of information sources**: Explicit mentions in content > Dates in URL/title > Metadata

## Performance Considerations
- Prioritize analysis of the most relevant results first
- Evaluate the chronological positioning of flow information
- Evaluate the update status and comprehensiveness of stock information`;
