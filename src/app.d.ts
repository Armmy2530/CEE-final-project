import type { SessionUser } from '$lib/server/db';
import type { AppRuntime } from '$lib/server/runtime';

declare global {
  namespace App {
    interface Locals {
      user: SessionUser | null;
      runtime: AppRuntime;
    }

    interface PageState {
      page?: 'summary' | 'projects' | 'calendar' | 'members' | 'budget' | 'users';
      projectId?: string | null;
    }
  }
}

export {};
