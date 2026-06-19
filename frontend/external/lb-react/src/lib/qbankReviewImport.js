import { qbankApiBase } from './qbankApi';

const text = (value) => String(value ?? '').trim();

const hashString = (value) => {
  let hash = 0;
  const source = String(value || '');
  for (let i = 0; i < source.length; i += 1) {
    hash = ((hash << 5) - hash + source.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
};

const rowQuestionText = (row = {}) => (
  text(row['Question text(Mandatory)']) ||
  text(row['Question Header']) ||
  text(row.Question) ||
  text(row.question)
);

export const hasExtractionReviewableRows = (rows = []) => (
  Array.isArray(rows) && rows.some((row) => Boolean(rowQuestionText(row)))
);

export const buildExtractionReviewImportSignature = (jobId, rows = []) => {
  const digestSource = rows
    .map((row) => Object.keys(row || {})
      .sort()
      .map((key) => `${key}:${text(row[key])}`)
      .join('~'))
    .join('|');

  return `${jobId || 'manual'}:${rows.length}:${hashString(digestSource)}`;
};

export const importExtractionRowsToQBankReview = (axiosInstance, payload) => (
  axiosInstance.post(`${qbankApiBase()}/reviews/extraction/import`, payload)
);
