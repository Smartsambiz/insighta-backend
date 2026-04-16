const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');
const { PrismaClient } = require('@prisma/client');

// 1. Create a connection pool to Postgres
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// 2. Create the adapter
const adapter = new PrismaPg(pool);

// 3. Pass the adapter to Prisma (This fixes your error)
const prisma = new PrismaClient({ adapter });

module.exports = { prisma };
