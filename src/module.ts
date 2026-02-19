/**
 * Abstract base class for Aurora Shell modules
 */
export abstract class Module {
  abstract enable(): void;
  abstract disable(): void;
}
