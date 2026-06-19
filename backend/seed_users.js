const bcrypt = require("bcrypt");
const { PrismaClient } = require("./src/generated/prisma");

const prisma = new PrismaClient();

async function seedUsers() {
  console.log("=== Seeding default accounts ===");

  try {
    // 1. Fetch current users
    let users = await prisma.user.findMany({
      include: {
        userRoles: {
          include: { role: true }
        }
      }
    });

    console.log("Current Users in DB:", users.map(u => ({
      email: u.email,
      name: u.name,
      roles: u.userRoles.map(ur => ur.role.name)
    })));

    // 2. Define default users
    const defaultUsers = [
      {
        name: "Admin User",
        email: "admin@example.com",
        password: "password123",
        role: "ADMIN"
      },
      {
        name: "Teacher User",
        email: "teacher@example.com",
        password: "password123",
        role: "TEACHER"
      }
    ];

    // 3. Create them if they don't exist
    for (const defUser of defaultUsers) {
      const existing = await prisma.user.findUnique({
        where: { email: defUser.email }
      });

      if (!existing) {
        console.log(`Creating ${defUser.role} account (${defUser.email})...`);
        const hashedPassword = await bcrypt.hash(defUser.password, 10);
        
        // Find role
        const roleObj = await prisma.role.findUnique({
          where: { name: defUser.role }
        });

        if (!roleObj) {
          throw new Error(`Role ${defUser.role} not found. Please run seed.js first.`);
        }

        await prisma.$transaction(async (tx) => {
          const user = await tx.user.create({
            data: {
              name: defUser.name,
              email: defUser.email,
              password: hashedPassword
            }
          });

          await tx.userRole.create({
            data: {
              userId: user.id,
              roleId: roleObj.id
            }
          });
        });
        console.log(`Created ${defUser.role} successfully!`);
      } else {
        console.log(`Account ${defUser.email} already exists.`);
      }
    }

    // Print final list of users
    users = await prisma.user.findMany({
      include: {
        userRoles: {
          include: { role: true }
        }
      }
    });
    console.log("Final Database Users List:", users.map(u => ({
      email: u.email,
      name: u.name,
      roles: u.userRoles.map(ur => ur.role.name)
    })));
  } catch (err) {
    console.error("Failed to seed users:", err);
  } finally {
    await prisma.$disconnect();
  }
}

seedUsers();
