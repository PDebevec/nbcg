<template>
  <component
    :is="href ? 'a' : 'router-link'"
    :to="href ? undefined : to"
    :href="href"
    :target="href ? '_blank' : undefined"
    :rel="href ? 'noopener' : undefined"
    class="link-card"
    :class="{ 'link-card--navy': navy }"
  >
    <span class="link-card__icon"><q-icon :name="icon" size="22px" /></span>
    <span class="link-card__text">
      <span class="link-card__title">{{ title }}</span>
      <span v-if="text" class="link-card__desc">{{ text }}</span>
    </span>
    <q-icon :name="href ? 'o_open_in_new' : 'o_arrow_forward'" size="16px" class="link-card__arrow" />
  </component>
</template>

<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router';

// A whole-card link in a sidebar: icon box, title, one line of text, arrow.

defineProps<{
  icon: string;
  title: string;
  text?: string;
  to?: RouteLocationRaw;
  /** External link instead of a route */
  href?: string;
  navy?: boolean;
}>();
</script>

<style scoped lang="sass">
.link-card
  display: flex
  align-items: center
  gap: 16px
  padding: 20px 22px
  background: $surface
  border: 1px solid $divider
  border-radius: 10px
  color: $ink
  text-decoration: none
  transition: border-color 0.15s, box-shadow 0.15s
  &:hover
    border-color: $primary
    box-shadow: 0 4px 18px rgba($dark, 0.08)

  &--navy
    background: $primary
    border-color: $primary
    color: white
    &:hover
      border-color: $primary
      box-shadow: 0 6px 20px rgba($primary, 0.35)

.link-card__icon
  width: 46px
  height: 46px
  flex-shrink: 0
  display: flex
  align-items: center
  justify-content: center
  border-radius: 10px
  background: #F1EADB
  color: $primary
  .link-card--navy &
    background: rgba($paper, 0.12)
    color: white

.link-card__text
  display: flex
  flex-direction: column
  gap: 3px
  flex-grow: 1
  min-width: 0

.link-card__title
  font-size: 15.5px
  font-weight: 600

.link-card__desc
  font-size: 13.5px
  color: $muted
  .link-card--navy &
    color: $on-navy

.link-card__arrow
  flex-shrink: 0
  color: $primary
  .link-card--navy &
    color: white
</style>
