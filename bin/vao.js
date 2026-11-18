#!/usr/bin/env node
// virtual-agent-office / vao — run `vao help` for all commands.
import { main } from '../server/cli.js';

await main(process.argv.slice(2));
