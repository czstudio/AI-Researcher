// Boot helpers kept separate so serve.mjs stays readable.

import { DATA_DIR, ensureDir } from './util.mjs';
import { llmConfigured } from './llm.mjs';

export { ensureDir, DATA_DIR };

export function llmConfiguredSafe() {
  try {
    return llmConfigured();
  } catch {
    return false;
  }
}
