'use strict';
/**
 * Which SQLite engine to use.
 *
 *  - Windows 10/11 program (modern Electron): Node's built-in SQLite (no extra files).
 *  - Windows 7/8/8.1 program (Electron 22, older Node without built-in SQLite):
 *    the "better-sqlite3" package, which understands exactly the calls used in db.js
 *    (new Database(file), exec, prepare().all/get/run, close). The release workflow
 *    installs it only for that build.
 *
 * Everything else in the program is identical for both, so data and backups are
 * interchangeable between the two kinds of computer.
 */
let DatabaseSync;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch (e) {
  DatabaseSync = require('better-sqlite3');
}
module.exports = { DatabaseSync };
