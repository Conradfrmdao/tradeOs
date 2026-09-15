// Thin re-export so application code imports `@tradeos/db` and never depends
// on where Prisma happens to generate its client.
module.exports = require('@prisma/client');
