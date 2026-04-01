import type { ExtensionContext } from "./core/context.ts";

/**
 * Abstract base class for Aurora Shell modules
 */
export abstract class Module {
  constructor(protected context: ExtensionContext) {}
  abstract enable(): void;
  abstract disable(): void;
}
