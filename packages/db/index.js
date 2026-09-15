// Thin re-export so application code imports `@tradeos/db` and never reaches
// into the generated client directory directly.
const client = require('./generated/client');

module.exports = client;
