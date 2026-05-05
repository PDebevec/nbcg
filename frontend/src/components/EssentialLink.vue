<template>
  <q-item
    clickable
    v-ripple
    :to="isInternal ? link : undefined"
    :tag="isInternal ? 'a' : 'a'"
    :href="isInternal ? undefined : link"
    :target="isInternal ? undefined : '_blank'"
  >
    <q-item-section v-if="icon" avatar>
      <q-icon :name="icon" />
    </q-item-section>

    <q-item-section>
      <q-item-label>{{ title }}</q-item-label>
    </q-item-section>
  </q-item>
</template>

<script setup lang="ts">
import { computed } from 'vue';

export interface EssentialLinkProps {
  title: string;
  caption?: string;
  link?: string;
  icon?: string;
}

const props = withDefaults(defineProps<EssentialLinkProps>(), {
  caption: '',
  link: '#',
  icon: '',
});

const isInternal = computed(() => !!props.link && props.link.startsWith('/'));
</script>
