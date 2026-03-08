#!/usr/bin/env node

/**
 * Open Legal Codes CLI
 *
 * Usage:
 *   npx open-legal-codes crawl --jurisdiction ca-palm-desert
 *   npx open-legal-codes crawl --state CA
 *   npx open-legal-codes list --state CA
 */

const args = process.argv.slice(2);
const command = args[0];

switch (command) {
  case 'crawl': {
    const jurisdictionIdx = args.indexOf('--jurisdiction');
    const stateIdx = args.indexOf('--state');

    const jurisdiction = jurisdictionIdx !== -1 ? args[jurisdictionIdx + 1] : undefined;
    const state = stateIdx !== -1 ? args[stateIdx + 1] : undefined;

    if (!jurisdiction && !state) {
      console.error('Usage: open-legal-codes crawl --jurisdiction <id> | --state <XX>');
      process.exit(1);
    }

    console.log(`TODO: Crawl ${jurisdiction ? `jurisdiction: ${jurisdiction}` : `state: ${state}`}`);
    // TODO: Instantiate crawler, fetch TOC, fetch sections, convert, write
    break;
  }

  case 'list': {
    const stateIdx = args.indexOf('--state');
    const state = stateIdx !== -1 ? args[stateIdx + 1] : undefined;

    console.log(`TODO: List jurisdictions${state ? ` in ${state}` : ''}`);
    // TODO: Query publisher APIs for available jurisdictions
    break;
  }

  default:
    console.error(`Unknown command: ${command}`);
    console.error('Available commands: crawl, list');
    process.exit(1);
}
