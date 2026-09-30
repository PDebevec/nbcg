<template>
  <header class="page-header">
    <div class="page-header__text">
      <router-link v-if="backTo" :to="backTo" class="page-header__eyebrow page-header__eyebrow--link">
        <q-icon name="o_arrow_back" size="14px" />
        <span>{{ eyebrow }}</span>
      </router-link>
      <div v-else-if="eyebrow" class="page-header__eyebrow">{{ eyebrow }}</div>

      <div class="page-header__title-row">
        <h1 class="page-header__title">{{ title }}</h1>
        <slot name="title-append" />
      </div>

      <div v-if="caption || $slots.caption" class="page-header__caption">
        <slot name="caption">{{ caption }}</slot>
      </div>
    </div>

    <div v-if="$slots.actions" class="page-header__actions">
      <slot name="actions" />
    </div>
  </header>
</template>

<script setup lang="ts">
// The header every admin page starts with: eyebrow (or a back link), serif
// title, caption, actions on the right. There is no layout-level top bar.

defineProps<{
  title: string;
  eyebrow?: string | undefined;
  caption?: string | undefined;
  /** Turns the eyebrow into a link back to the parent list. */
  backTo?: string | undefined;
}>();
</script>

<style scoped lang="sass">
.page-header
  display: flex
  align-items: flex-end
  gap: 24px
  padding-bottom: 20px
  border-bottom: 1px solid $divider
  margin-bottom: 24px

.page-header__text
  display: flex
  flex-direction: column
  gap: 6px
  flex: 1 1 auto
  min-width: 0

.page-header__eyebrow
  font-size: 12px
  letter-spacing: 0.1em
  text-transform: uppercase
  color: $eyebrow
  font-weight: 600

.page-header__eyebrow--link
  display: inline-flex
  align-items: center
  gap: 6px
  align-self: flex-start
  text-decoration: none
  &:hover
    text-decoration: underline

.page-header__title-row
  display: flex
  align-items: center
  gap: 12px
  min-width: 0

.page-header__title
  margin: 0
  font-family: $admin-serif
  font-size: 30px
  font-weight: 600
  line-height: 1.15
  letter-spacing: 0
  color: $ink
  white-space: nowrap
  overflow: hidden
  text-overflow: ellipsis

.page-header__caption
  font-size: 14px
  color: $muted

.page-header__actions
  display: flex
  align-items: center
  gap: 8px
  flex: none
</style>
