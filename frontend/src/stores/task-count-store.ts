import { defineStore } from 'pinia';
import { listTasks } from 'src/api/tasks';

// The number on the drawer's Tasks item: open tasks assigned to the signed-in
// user. There are no notifications, so this count is how a person notices that
// something is waiting. Pages call `refresh()` after an action that moves a
// task; the layout refreshes it on navigation.

export const useTaskCountStore = defineStore('taskCount', {
  state: () => ({ open: 0 }),

  actions: {
    async refresh(): Promise<void> {
      try {
        const result = await listTasks({ assignedTo: 'me', status: 'OPEN', limit: 1 });
        this.open = result.total;
      } catch {
        // Decoration only — a failed count must not break the shell.
      }
    },
  },
});
