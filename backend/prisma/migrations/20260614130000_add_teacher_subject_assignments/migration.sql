-- Create teacher-to-subject assignment table.
CREATE TABLE `user_subjects` (
    `userId` INTEGER NOT NULL,
    `subjectId` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `user_subjects_subjectId_idx`(`subjectId`),
    PRIMARY KEY (`userId`, `subjectId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `user_subjects`
    ADD CONSTRAINT `user_subjects_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `user_subjects`
    ADD CONSTRAINT `user_subjects_subjectId_fkey`
    FOREIGN KEY (`subjectId`) REFERENCES `subjects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Remove the retired SUPPORT role before narrowing the role enum to ADMIN/TEACHER.
UPDATE `users` AS `u`
INNER JOIN `user_roles` AS `support_ur` ON `support_ur`.`userId` = `u`.`id`
INNER JOIN `roles` AS `support_role` ON `support_role`.`id` = `support_ur`.`roleId`
LEFT JOIN `user_roles` AS `keep_ur`
    ON `keep_ur`.`userId` = `u`.`id`
    AND `keep_ur`.`isDeleted` = 0
LEFT JOIN `roles` AS `keep_role`
    ON `keep_role`.`id` = `keep_ur`.`roleId`
    AND `keep_role`.`name` IN ('ADMIN', 'TEACHER')
SET
    `u`.`isActive` = 0,
    `u`.`isDeleted` = 1,
    `u`.`deletedAt` = COALESCE(`u`.`deletedAt`, CURRENT_TIMESTAMP(3))
WHERE `support_role`.`name` = 'SUPPORT'
  AND `keep_role`.`id` IS NULL;

DELETE `rp`
FROM `role_permissions` AS `rp`
INNER JOIN `roles` AS `r` ON `r`.`id` = `rp`.`roleId`
WHERE `r`.`name` = 'SUPPORT';

DELETE `ur`
FROM `user_roles` AS `ur`
INNER JOIN `roles` AS `r` ON `r`.`id` = `ur`.`roleId`
WHERE `r`.`name` = 'SUPPORT';

DELETE FROM `roles`
WHERE `name` = 'SUPPORT';

ALTER TABLE `roles`
    MODIFY `name` ENUM('ADMIN', 'TEACHER') NOT NULL;
