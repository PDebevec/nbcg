<template>
  <FormField :label="label ?? t('admin.tasks.picker.label')" :required="required">
    <q-select
      :model-value="modelValue"
      :options="options"
      :loading="loading"
      option-value="userId"
      option-label="displayName"
      outlined
      dense
      clearable
      use-input
      input-debounce="300"
      hide-selected
      fill-input
      hide-bottom-space
      :placeholder="modelValue ? undefined : (placeholder ?? t('admin.tasks.picker.placeholder'))"
      :error="error"
      :error-message="errorMessage"
      @filter="filterUsers"
      @update:model-value="emit('update:modelValue', $event)"
    >
      <template #prepend>
        <UserAvatar v-if="modelValue" :name="modelValue.displayName" :size="24" />
        <q-icon v-else name="o_person" size="20px" />
      </template>
      <template #option="scope">
        <q-item v-bind="scope.itemProps">
          <q-item-section avatar>
            <UserAvatar :name="scope.opt.displayName" :size="28" />
          </q-item-section>
          <q-item-section>
            <q-item-label>{{ scope.opt.displayName }}</q-item-label>
            <q-item-label caption>{{ scope.opt.email || scope.opt.username }}</q-item-label>
          </q-item-section>
        </q-item>
      </template>
      <template #no-option>
        <q-item>
          <q-item-section class="adm-muted">{{ t('admin.tasks.picker.empty') }}</q-item-section>
        </q-item>
      </template>
    </q-select>
    <template #hint>
      <span>{{ hint ?? t(`admin.tasks.picker.hint.${capability}`) }}</span>
      <a v-if="offerMe" href="#" class="assign-me" @click.prevent="assignToMe">
        {{ t('admin.tasks.picker.assignToMe') }}
      </a>
    </template>
  </FormField>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ItemType } from 'src/api/admin';
import { listUsers, type PickedUser, type UserProfile } from 'src/api/users';
import { pickerCapability, type TaskKind } from 'src/api/tasks';
import { auth } from 'src/services/keycloak';
import FormField from 'src/components/admin/FormField.vue';
import UserAvatar from 'src/components/admin/UserAvatar.vue';

// ---------------------------------------------------------------------------
// Searchable person picker over GET /users, capability-aware.
//
// The capability is derived HERE from (stage, item type) so the one rule lives
// in one place: a review needs a publisher, a metadata fix needs someone who
// can edit the item as it is NOW (a cataloguer cannot edit a published
// record). For a return, pass the stage the task lands in. The server
// re-checks the same rule and answers 400, so this is only an affordance.
//
// No caching: the directory is synced from Keycloak daily and a cached picker
// would offer people who have left. Fetch per keystroke, debounced, small limit.
// ---------------------------------------------------------------------------

const props = defineProps<{
  modelValue: PickedUser | null;
  /** The stage the task will be in AFTER the assignment lands. */
  kind: TaskKind;
  itemType: ItemType | null;
  label?: string | undefined;
  hint?: string | undefined;
  placeholder?: string | undefined;
  required?: boolean;
  /** Hidden from the options — e.g. the caller and the current holder when reassigning. */
  excludeUserIds?: string[] | undefined;
  /** Offer an "Assign to me" shortcut under the field. */
  showAssignToMe?: boolean;
  error?: boolean;
  errorMessage?: string | undefined;
}>();

const emit = defineEmits<{ (e: 'update:modelValue', value: PickedUser | null): void }>();

const { t } = useI18n();

const capability = computed(() => pickerCapability(props.kind, props.itemType));

const options = ref<UserProfile[]>([]);
const loading = ref(false);

function filterUsers(input: string, doneFn: (callback: () => void) => void, abortFn: () => void) {
  const q = input.trim();
  loading.value = true;
  listUsers({ capability: capability.value, ...(q ? { q, limit: 5 } : { limit: 10 }) })
    .then((result) => {
      doneFn(() => {
        options.value = result.users.filter((u) => !props.excludeUserIds?.includes(u.userId));
      });
    })
    .catch(() => abortFn())
    .finally(() => {
      loading.value = false;
    });
}

const offerMe = computed(
  () =>
    props.showAssignToMe &&
    !!auth.userId &&
    props.modelValue?.userId !== auth.userId &&
    !props.excludeUserIds?.includes(auth.userId),
);

function assignToMe() {
  if (!auth.userId) return;
  emit('update:modelValue', {
    userId: auth.userId,
    displayName: auth.fullName || auth.username || '',
  });
}

// A selection made under one capability may be invalid under the next (a
// cataloguer picked for GENERAL, then the stage switched to REVIEW_PUBLISH).
// Clearing beats letting the user submit into a 400.
watch(capability, () => {
  options.value = [];
  if (props.modelValue) emit('update:modelValue', null);
});
</script>

<style scoped lang="sass">
.assign-me
  margin-left: 8px
  font-weight: 600
  color: $primary
</style>
