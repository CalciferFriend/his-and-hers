#!/usr/bin/env node
/**
 * cofounder — user-facing entry point
 *
 * This thin wrapper re-exports the @cofounder/cli binary so that:
 *   npx cofounder          → runs the wizard (or shows status if configured)
 *   npx cofounder onboard  → explicit wizard
 *   npx cofounder status   → connectivity status
 *   npx cofounder send "do X" → delegate task to peer
 *
 * All real logic lives in @cofounder/cli.
 */
import "@cofounder/cli";
