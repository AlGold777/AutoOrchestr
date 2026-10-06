// Volatile, non-persisted resources for one Debate application run.
(function initDebateExecutionContext(root) {
  'use strict';

  function createExecutionContext(options = {}) {
    const AbortControllerImpl = options.AbortController || root.AbortController || null;
    let current = null;

    const cleanupApproval = (reason) => {
      const approval = current?.approval;
      if (!approval) return false;
      current.approval = null;
      try { approval.cleanup?.(); } catch (_) {}
      if (reason !== undefined) {
        try { approval.reject?.(reason); } catch (_) {}
      }
      return true;
    };

    const api = Object.freeze({
      begin(runId, seed = {}) {
        api.dispose(new Error('Debate execution context replaced'));
        current = {
          runId: String(runId || ''),
          abortController: seed.abortController || (AbortControllerImpl ? new AbortControllerImpl() : null),
          approval: null,
          locks: new Set(),
          pending: new Map(),
          cleanup: new Set()
        };
        return current;
      },
      get() {
        return current;
      },
      isCurrent(runId) {
        return !!current && String(runId || '') === current.runId;
      },
      signal() {
        return current?.abortController?.signal || null;
      },
      setApprovalWaiter(waiter = {}) {
        if (!current) throw new Error('Debate execution context is not active');
        cleanupApproval();
        current.approval = {
          resolve: typeof waiter.resolve === 'function' ? waiter.resolve : null,
          reject: typeof waiter.reject === 'function' ? waiter.reject : null,
          cleanup: typeof waiter.cleanup === 'function' ? waiter.cleanup : null
        };
      },
      resolveApproval(value) {
        const approval = current?.approval;
        if (!approval) return false;
        current.approval = null;
        try { approval.cleanup?.(); } catch (_) {}
        approval.resolve?.(value);
        return true;
      },
      hasApprovalWaiter() {
        return !!current?.approval;
      },
      clearApproval() {
        return cleanupApproval();
      },
      rejectApproval(reason) {
        return cleanupApproval(reason);
      },
      lock(name) {
        if (!current) return false;
        const key = String(name || 'default');
        if (current.locks.has(key)) return false;
        current.locks.add(key);
        return true;
      },
      unlock(name) {
        return current?.locks.delete(String(name || 'default')) || false;
      },
      track(key, value) {
        if (!current) return value;
        current.pending.set(String(key || ''), value);
        return value;
      },
      untrack(key) {
        const value = current?.pending.get(String(key || ''));
        current?.pending.delete(String(key || ''));
        return value;
      },
      onCleanup(callback) {
        if (current && typeof callback === 'function') current.cleanup.add(callback);
        return () => current?.cleanup.delete(callback);
      },
      abort(reason) {
        const controller = current?.abortController;
        if (!controller || controller.signal?.aborted) return false;
        controller.abort(reason);
        return true;
      },
      dispose(reason) {
        if (!current) return false;
        const previous = current;
        cleanupApproval(reason);
        if (!previous.abortController?.signal?.aborted) {
          try { previous.abortController?.abort(reason); } catch (_) {}
        }
        previous.cleanup.forEach((callback) => {
          try { callback(reason); } catch (_) {}
        });
        previous.cleanup.clear();
        previous.pending.clear();
        previous.locks.clear();
        current = null;
        return true;
      }
    });

    return api;
  }

  const api = Object.freeze({ createExecutionContext });
  root.DebateExecutionContext = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
