import * as fs from 'fs';
import * as crypto from 'crypto';
import { Page, Locator } from 'playwright';

function formatLogMeta(meta?: unknown): string {
  if (meta === undefined || meta === null) {
    return '';
  }

  const normalized = meta instanceof Error
    ? {
        name: meta.name,
        message: meta.message,
        stack: meta.stack
      }
    : meta;

  try {
    return JSON.stringify(normalized);
  } catch {
    return String(normalized);
  }
}

/**
 * Structured log helper for the Flow provider.
 */
export const logger = {
  info(message: string, meta?: unknown) {
    const timestamp = new Date().toISOString();
    console.log(`[FLOW] [INFO] [${timestamp}] ${message}`, formatLogMeta(meta));
  },
  warn(message: string, meta?: unknown) {
    const timestamp = new Date().toISOString();
    console.warn(`[FLOW] [WARN] [${timestamp}] ${message}`, formatLogMeta(meta));
  },
  error(message: string, error?: unknown) {
    const timestamp = new Date().toISOString();
    console.error(`[FLOW] [ERROR] [${timestamp}] ${message}`, formatLogMeta(error));
  }
};

/**
 * Ensures that the directory exists, creating nested folders if necessary.
 */
export function ensureDirExists(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    logger.info(`Directory created: ${dirPath}`);
  }
}

/**
 * Generates a unique UUID-based filename.
 */
export function generateFilename(prefix: string, ext: string): string {
  const uuid = crypto.randomUUID();
  // Clean extension (ensure it starts with .)
  const formattedExt = ext.startsWith('.') ? ext : `.${ext}`;
  return `${prefix}_${uuid}${formattedExt}`;
}

export interface ElementQuery {
  text?: string;
  placeholder?: string;
  role?: Parameters<Page['getByRole']>[0];
  ariaLabel?: string;
  selector?: string;
}

/**
 * Smart locator function that tries multiple query strategies to locate an element.
 * Tries strategies in sequence, falling back to next options if not found or visible.
 */
// eslint-disable-next-line complexity
export async function findSmartElement(
  page: Page,
  queries: ElementQuery[],
  timeoutMs = 10000
): Promise<Locator> {
  const startTime = Date.now();
  const errors: string[] = [];

  while (Date.now() - startTime < timeoutMs) {
    for (const query of queries) {
      try {
        let locator: Locator | null = null;

        if (query.selector) {
          locator = page.locator(query.selector);
        } else if (query.placeholder) {
          locator = page.getByPlaceholder(query.placeholder, { exact: false });
        } else if (query.ariaLabel) {
          locator = page.getByLabel(query.ariaLabel, { exact: false });
        } else if (query.text) {
          if (query.role) {
            locator = page.getByRole(query.role, { name: query.text, exact: false });
          } else {
            locator = page.getByText(query.text, { exact: false });
          }
        } else if (query.role) {
          locator = page.getByRole(query.role);
        }

        if (locator) {
          // Check if at least one element matching this locator is visible
          const count = await locator.count();
          for (let i = 0; i < count; i++) {
            const candidate = locator.nth(i);
            if (await candidate.isVisible()) {
              return candidate;
            }
          }
        }
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        errors.push(errMsg);
      }
    }
    // Sleep briefly before retrying
    await page.waitForTimeout(500);
  }

  throw new Error(
    `Failed to locate smart element within ${timeoutMs}ms. Queries: ${JSON.stringify(queries)}. Errors: ${errors.join('; ')}`
  );
}

/**
 * Polling helper that waits for a condition to be met.
 */
export async function pollCondition(
  page: Page,
  conditionFn: () => Promise<boolean>,
  errorMessage: string,
  timeoutMs = 120000,
  intervalMs = 2000
): Promise<void> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    try {
      const result = await conditionFn();
      if (result) return;
    } catch {
      // Ignore errors during polling
    }
    await page.waitForTimeout(intervalMs);
  }
  throw new Error(`Timeout: ${errorMessage} after ${timeoutMs}ms`);
}

/**
 * Gets the saved project URL if it exists.
 */
export function getSavedProjectUrl(): string | null {
  const filePath = 'storage/flow_project_url.txt';
  if (fs.existsSync(filePath)) {
    try {
      const url = fs.readFileSync(filePath, 'utf-8').trim();
      if (url.startsWith('https://') && url.includes('/project/')) {
        return url;
      }
    } catch {
      // Ignore
    }
  }
  return null;
}

/**
 * Saves the project URL to disk.
 */
export function saveProjectUrl(url: string): void {
  const filePath = 'storage/flow_project_url.txt';
  try {
    ensureDirExists('storage/');
    fs.writeFileSync(filePath, url, 'utf-8');
    logger.info(`Workspace URL salvo: ${url}`);
  } catch (err) {
    logger.warn('Falha ao salvar URL do projeto workspace.', err);
  }
}
