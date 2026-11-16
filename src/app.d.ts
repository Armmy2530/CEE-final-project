import type { SessionUser } from '$lib/server/db';
import type { AppRuntime } from '$lib/server/runtime';

declare global {
  namespace App {
    interface Locals {
      user: SessionUser | null;
      runtime: AppRuntime;
    }
  }
}

export {};
