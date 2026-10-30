<script setup lang="ts">
import {isVos} from "@/vos/bridge";
import { computed } from "vue";
import { useSettingsStore } from "@/stores/settingsStore";
import { webPath } from "@/lib/common/webPath";

const settingsStore = useSettingsStore();
const isBlackLogo = computed(() => settingsStore.desktopSettings.icon_theme === "black");
const logoSrc = computed(() => webPath(isVos ? "/pgv-logo.svg" : isBlackLogo.value ? "/logo-black.png" : "/logo.png"));
</script>

<template>
  <img :src="logoSrc" :alt="isVos ? 'PGV' : 'DBX'" :class="!isVos && isBlackLogo ? 'dark:invert' : ''" />
</template>
