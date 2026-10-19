<script setup lang="ts">
const baseUrl = import.meta.env.BASE_URL
</script>

<template>
  <div class="page about">
    <h1>Hello!</h1>

    <div class="about-content">
      <div class="about-text">
        <p>
          I’m a computer game engineer specializing in graphics and optimization, delivering high-quality results under tight deadlines. I’m also actively learning and mastering parallel computing.
        </p>

        <p>Check out the <a href="https://github.com/vishwah13/Agni">game engine</a> I have been making</p>

        <p>
          I'm currently working as a Programmer at Sumo India. Before that, I was an
          AR/VR Developer at Indus Trust. You can reach me at
          <a href="mailto:vishwahsivagurunathan@gmail.com">vishwahsivagurunathan@gmail.com</a>
          or <RouterLink to="/contact">through here</RouterLink>.
        </p>
      </div>

      <div class="about-photo">
        <img :src="`${baseUrl}img/Visu.png`" alt="Photo of Vishwah" />
      </div>
    </div>
  </div>
</template>
