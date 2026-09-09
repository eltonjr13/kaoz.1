import type { SketchProjectData } from '../../types/sketch.ts';

export type SaveStatus = 'saved' | 'saving' | 'error';

export interface PendingRevision {
  project: SketchProjectData;
  revision: number;
}

export interface SaveResult {
  success: boolean;
  savedRevision: number;
  error?: string;
}

export type PersistFunction = (toSave: SketchProjectData, revision: number) => Promise<boolean>;

export interface SaveCoordinatorOptions {
  onStatusChange?: (status: SaveStatus, error?: string | null) => void;
}

export class SketchSaveCoordinator {
  private currentRevision = 0;
  private savedRevision = 0;
  private inFlightRevision: number | null = null;
  private pendingRevision: PendingRevision | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private inFlightPromise: Promise<SaveResult> | null = null;
  private persistFn: PersistFunction;
  private options?: SaveCoordinatorOptions;

  constructor(persistFn: PersistFunction, options?: SaveCoordinatorOptions) {
    this.persistFn = persistFn;
    this.options = options;
  }

  public getCurrentRevision(): number {
    return this.currentRevision;
  }

  public getSavedRevision(): number {
    return this.savedRevision;
  }

  public getPendingRevision(): PendingRevision | null {
    return this.pendingRevision;
  }

  public isDirty(): boolean {
    return this.currentRevision > this.savedRevision;
  }

  public isSaving(): boolean {
    return this.inFlightRevision !== null;
  }

  public registerEdit(
    updatedProject: SketchProjectData,
    delayMs = 700,
    onScheduled?: () => void
  ): number {
    this.currentRevision += 1;
    const rev = this.currentRevision;
    this.pendingRevision = { project: updatedProject, revision: rev };

    this.options?.onStatusChange?.('saving', null);
    this.clearTimer();
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.executePendingSave();
    }, delayMs);

    onScheduled?.();
    return rev;
  }

  public clearTimer(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  public cancelPendingSave(): void {
    this.clearTimer();
    this.pendingRevision = null;
  }

  public reset(newProjectRevision = 0): void {
    this.clearTimer();
    this.pendingRevision = null;
    this.currentRevision = newProjectRevision;
    this.savedRevision = newProjectRevision;
    this.inFlightRevision = null;
    this.inFlightPromise = null;
    this.options?.onStatusChange?.('saved', null);
  }

  public async flushSave(): Promise<SaveResult> {
    this.clearTimer();

    if (this.inFlightPromise) {
      const inFlightRes = await this.inFlightPromise;
      if (!inFlightRes.success && this.isDirty()) {
        return inFlightRes;
      }
    }

    if (this.pendingRevision) {
      return await this.executePendingSave();
    }

    return {
      success: true,
      savedRevision: this.savedRevision,
    };
  }

  public computeSaveStatus(lastError: string | null): SaveStatus {
    if (lastError) return 'error';
    if (this.isSaving() || this.debounceTimer !== null || this.isDirty()) {
      return 'saving';
    }
    return 'saved';
  }

  private handleSaveCompletion(
    ok: boolean,
    revToSave: number,
    toSave: SketchProjectData,
    errMsg?: string
  ): SaveResult {
    if (ok) {
      this.savedRevision = Math.max(this.savedRevision, revToSave);
      const isStillDirty = this.currentRevision > this.savedRevision;
      this.options?.onStatusChange?.(isStillDirty ? 'saving' : 'saved', null);
      return { success: true, savedRevision: this.savedRevision };
    }

    if (!this.pendingRevision) {
      this.pendingRevision = { project: toSave, revision: revToSave };
    }
    const err = errMsg || 'Falha ao persistir no servidor';
    this.options?.onStatusChange?.('error', err);
    return { success: false, savedRevision: this.savedRevision, error: err };
  }

  private async executePendingSave(): Promise<SaveResult> {
    if (!this.pendingRevision) {
      return { success: true, savedRevision: this.savedRevision };
    }

    const toSave = this.pendingRevision.project;
    const revToSave = this.pendingRevision.revision;
    this.pendingRevision = null;
    this.inFlightRevision = revToSave;
    this.options?.onStatusChange?.('saving', null);

    const promise = (async (): Promise<SaveResult> => {
      try {
        const ok = await this.persistFn(toSave, revToSave);
        return this.handleSaveCompletion(ok, revToSave, toSave);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return this.handleSaveCompletion(false, revToSave, toSave, msg);
      } finally {
        this.inFlightRevision = null;
        this.inFlightPromise = null;
        if (this.pendingRevision && !this.debounceTimer) {
          this.debounceTimer = setTimeout(() => {
            this.debounceTimer = null;
            void this.executePendingSave();
          }, 300);
        }
      }
    })();

    this.inFlightPromise = promise;
    return await promise;
  }
}
