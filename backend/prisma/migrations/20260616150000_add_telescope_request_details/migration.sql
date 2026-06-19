ALTER TABLE `telescope_request_logs`
  ADD COLUMN `queryParams` JSON NULL,
  ADD COLUMN `requestHeaders` JSON NULL,
  ADD COLUMN `requestPayload` JSON NULL,
  ADD COLUMN `responseHeaders` JSON NULL,
  ADD COLUMN `responseBody` JSON NULL,
  ADD COLUMN `tags` JSON NULL,
  ADD COLUMN `memoryMb` DOUBLE NULL;
