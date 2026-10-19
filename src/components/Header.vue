<script setup lang="ts">
// Navigation component - no logic needed
</script>

<template>
  <header class="header">
    <nav class="nav-bar">
      <RouterLink to="/" class="nav-link">About</RouterLink>
      <RouterLink to="/game-projects" class="nav-link">Projects</RouterLink>
      <!-- Separate Quartz site (vishwah13/notes), not a route in this app -->
      <a href="/notes/" class="nav-link">Notes</a>
      <!-- <RouterLink to="/blog" class="nav-link">Blog</RouterLink> -->
      <RouterLink to="/resume" class="nav-link">Resume</RouterLink>
      <RouterLink to="/contact" class="nav-link">Contact</RouterLink>
    </nav>
  </header>
</template>
