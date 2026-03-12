#!/usr/bin/env node
/**
 * his-and-hers — user-facing entry point
 *
 * This thin wrapper re-exports the @his-and-hers/cli binary so that:
 *   npx his-and-hers          → runs the wizard (or shows status if configured)
 *   npx his-and-hers onboard  → explicit wizard
 *   npx his-and-hers status   → connectivity status
 *   npx his-and-hers send "do X" → delegate task to peer
 *
 * All real logic lives in @his-and-hers/cli.
 */
import "@his-and-hers/cli";
