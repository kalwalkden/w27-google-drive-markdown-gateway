export interface ConsumedApprovalStore {
  /** Atomically records an approval identifier and returns false if it was already consumed. */
  consumeOnce(approvalId: string, expiresAt: Date): Promise<boolean>;
}

/** Test-only replay store. Production must inject durable transactional storage. */
export class InMemoryConsumedApprovalStore implements ConsumedApprovalStore {
  private readonly consumed = new Map<string, number>();

  constructor(private readonly now: () => number = Date.now) {}

  async consumeOnce(approvalId: string, expiresAt: Date): Promise<boolean> {
    const now = this.now();
    for (const [id, expiry] of this.consumed) {
      if (expiry <= now) this.consumed.delete(id);
    }
    if (this.consumed.has(approvalId)) return false;
    this.consumed.set(approvalId, expiresAt.getTime());
    return true;
  }
}
