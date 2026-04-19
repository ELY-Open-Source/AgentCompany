/**
 * One-time settable slot for services that participate in a cycle during
 * assembly. `set()` may be called exactly once; `get()` throws until the
 * slot has been set. Eliminates the lazy-null `let` pattern that service-graph
 * previously used to wire `workerService.dispatchRunToWorker` against
 * `orchestrationService` before the latter exists.
 */
export class LateBinding<T> {
  private value: T | null = null;
  private assigned = false;

  constructor(private readonly label: string) {}

  set(value: T): void {
    if (this.assigned) {
      throw new Error(`LateBinding<${this.label}> is already assigned.`);
    }
    this.value = value;
    this.assigned = true;
  }

  get(): T {
    if (!this.assigned || this.value === null) {
      throw new Error(`LateBinding<${this.label}> accessed before assignment.`);
    }
    return this.value;
  }

  isAssigned(): boolean {
    return this.assigned;
  }

  clear(): void {
    this.value = null;
    this.assigned = false;
  }
}
