<template>
  <q-select
    :model-value="modelValue"
    :options="options"
    :loading="loading"
    option-value="userId"
    option-label="displayName"
    outlined
    clearable
    use-input
    input-debounce="300"
    hide-selected
    fill-input
    :label="label ?? t('admin.tasks.picker.label')"
    :hint="
      capability === 'publish'
        ? t('admin.tasks.picker.hintPublish')
        : t('admin.tasks.picker.hintStaff')
    "
    :placeholder="modelValue ? undefined : t('admin.tasks.picker.placeholder')"
    :error="error"
    :error-message="errorMessage"
    @filter="filterUsers"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <template #prepend><q-icon name="person" /></template>
    <template #option="scope">
      <q-item v-bind="scope.itemProps">
        <q-item-section>
          <q-item-label>{{ scope.opt.displayName }}</q-item-label>
          <q-item-label caption>{{ scope.opt.email || scope.opt.username }}</q-item-label>
        </q-item-section>
      </q-item>
    </template>
    <template #no-option>
      <q-item>
        <q-item-section class="text-library-muted">
          {{ t('admin.tasks.picker.empty') }}
        </q-item-section>
      </q-item>
    </template>
  </q-select>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { listUsers, type PickedUser, type UserProfile } from 'src/api/users';
import { pickerCapability, type TaskKind, type TaskStatus } from 'src/api/tasks';

// ---------------------------------------------------------------------------
// Searchable person picker over GET /users, capability-aware.
//
// The capability is derived HERE from (kind, status) so the one rule lives in
// one place: a REVIEW_PUBLISH task needs a publisher while it sits with the
// reviewer, but a RETURNED one goes to whoever must fix it. Getting this
// backwards is the easiest mistake in the feature. The server re-checks the
// same rule and answers 400, so this is only an affordance.
//
// No caching: the directory is synced from Keycloak daily and a cached picker
// would offer people who have left. Fetch per keystroke, debounced, small limit.
// ---------------------------------------------------------------------------

const props = defineProps<{
  modelValue: PickedUser | null;
  kind: TaskKind;
  /** The status the task will be in AFTER the assignment lands. */
  status: TaskStatus;
  label?: string;
  /** Hidden from the options — e.g. the current assignee when returning a task. */
  excludeUserId?: string | undefined;
  error?: boolean;
  errorMessage?: string;
}>();

const emit = defineEmits<{ (e: 'update:modelValue', value: PickedUser | null): void }>();

const { t } = useI18n();

const capability = computed(() => pickerCapability(props.kind, props.status));

const options = ref<UserProfile[]>([]);
const loading = ref(false);

function filterUsers(input: string, doneFn: (callback: () => void) => void, abortFn: () => void) {
  const q = input.trim();
  loading.value = true;
  listUsers({ capability: capability.value, ...(q ? { q, limit: 5 } : { limit: 10 }) })
    .then((result) => {
      doneFn(() => {
        options.value = result.users.filter((u) => u.userId !== props.excludeUserId);
      });
    })
    .catch(() => abortFn())
    .finally(() => {
      loading.value = false;
    });
}

// A selection made under one capability may be invalid under the next (a
// cataloguer picked for GENERAL, then kind switched to REVIEW_PUBLISH).
// Clearing beats letting the user submit into a 400.
watch(capability, () => {
  options.value = [];
  if (props.modelValue) emit('update:modelValue', null);
});
</script>
