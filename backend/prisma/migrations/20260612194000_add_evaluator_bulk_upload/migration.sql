CREATE TABLE `evaluators` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `fullName` VARCHAR(160) NOT NULL,
  `mobile` VARCHAR(30) NOT NULL,
  `email` VARCHAR(160) NULL,
  `pan` VARCHAR(20) NULL,
  `aadhaar` VARCHAR(20) NULL,
  `designation` VARCHAR(120) NULL,
  `rowNumber` INTEGER NULL,
  `status` VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
  `uploadedById` INTEGER NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  INDEX `evaluators_fullName_idx`(`fullName`),
  INDEX `evaluators_mobile_idx`(`mobile`),
  INDEX `evaluators_email_idx`(`email`),
  INDEX `evaluators_pan_idx`(`pan`),
  INDEX `evaluators_aadhaar_idx`(`aadhaar`),
  INDEX `evaluators_designation_idx`(`designation`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `evaluator_documents` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `evaluatorId` INTEGER NOT NULL,
  `fileName` VARCHAR(255) NOT NULL,
  `originalName` VARCHAR(255) NOT NULL,
  `filePath` VARCHAR(500) NOT NULL,
  `fileSize` INTEGER NOT NULL,
  `mimeType` VARCHAR(120) NOT NULL,
  `documentType` VARCHAR(80) NULL,
  `uploadedById` INTEGER NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `evaluator_documents_evaluatorId_idx`(`evaluatorId`),
  INDEX `evaluator_documents_uploadedById_idx`(`uploadedById`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `evaluators`
  ADD CONSTRAINT `evaluators_uploadedById_fkey`
  FOREIGN KEY (`uploadedById`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `evaluator_documents`
  ADD CONSTRAINT `evaluator_documents_evaluatorId_fkey`
  FOREIGN KEY (`evaluatorId`) REFERENCES `evaluators`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `evaluator_documents`
  ADD CONSTRAINT `evaluator_documents_uploadedById_fkey`
  FOREIGN KEY (`uploadedById`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
