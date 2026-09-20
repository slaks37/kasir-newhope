#!/usr/bin/env node
/** Keep the existing npm/cron entry point; all analytics live in the shared engine. */
import { pathToFileURL } from 'node:url';
import { tsImport } from 'tsx/esm/api';

// Importing this module in tests must never connect to a database or start a job.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    const { main } = await tsImport('./run-shared-insights.ts', import.meta.url);
    process.exitCode = await main();
  } catch {
    // Database errors can contain SQL, connection details, or business data.
    console.error('DAILY_INSIGHTS_FAILED');
    process.exitCode = 1;
  }
}
