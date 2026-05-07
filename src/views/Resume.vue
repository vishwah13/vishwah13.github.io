<script setup lang="ts">
const baseUrl = import.meta.env.BASE_URL
</script>

<template>
  <div class="page resume">
    <h1>Resume</h1>

    <div class="resume-header">
      <div class="resume-intro">
        <p>
         Graphics and game engine programmer with a Master’s in Computer Game Engineering (Distinction) from Newcastle University. Proficient in modern C++, HLSL, and Slang with hands-on experience in Vulkan, GPU-driven rendering, PBR, and shader development. Built a 3D Gaussian Splatting renderer and shipped VR/XR experiences on Meta Quest 3 hardware. Skilled in building scalable systems, debugging performance bottlenecks, and collaborating with cross-functional teams to deliver high-quality interactive experiences.
        </p>

        <a class="download-link" :href="`${baseUrl}d/Vishwah_Sivagurunathan.pdf`" target="_blank">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          Download as PDF
        </a>
      </div>

      <div class="about-photo">
        <img :src="`${baseUrl}img/Visu.png`" alt="Photo of Vishwah" />
      </div>
    </div>

    <div class="resume-content">
      <h2>Experience</h2>

      <h3>AR VR Developer - Indus Trust (Full-time) - March 2025 - Present</h3>
      <p>Research and development of Augmented Reality and Virtual Reality application for the educational environment.</p>

      <h3>C++ Developer - Microfacet.io (Volunteering, Non-Profit) - April 2025 - December 2025</h3>
      <p>Architected and developed a Cross-Platform high-performance Physically Based Rendering software.</p>

      <h3>Unreal Engine Developer - Norian Games - April 2024 – August 2024</h3>
      <p>AI and gameplay programming for an multiplayer dinosaur survival game.</p>

       <h3>Game Developer - StuBrew (Newcastle Univeristy) - May 2023 – August 2023</h3>
      <p>VR Simulation of the local brewery, made using Unreal Engine 5.</p>

      <h2>Education</h2>

      <h3>Newcastle University - 2023</h3>
      <h4>MSc in Computer Game Engineering</h4>
      <p>Specialty in making computer and console video games</p>

      <h3>Sri Manakula Vinayagar Engineering College - 2021</h3>
      <h4>B.Tech in Computer Science and Engineering</h4>
      <p>Specialty in software</p>

      <h2>Skills</h2>

      <div class="skill-set">
        <h3>Languages & Scripting</h3>
        <span class="skill">C</span>
        <span class="skill">C#</span>
        <span class="skill">C++</span>
        <span class="skill">GLSL</span>
        <span class="skill">HLSL</span>
        <span class="skill">Slang</span>
        <span class="skill">Unreal Blueprints</span>
        <span class="skill">GD Script</span>
        <span class="skill">HTML</span>
        <span class="skill">CSS</span>
        <span class="skill">JavaScript</span>
      </div>

      <div class="skill-set">
        <h3>Engines & Libraries</h3>
        <span class="skill">Unity</span>
        <span class="skill">Unreal Engine 4/5</span>
        <span class="skill">Godot Engine</span>
        <span class="skill">Raylib</span>
        <span class="skill">SDL</span>
        <span class="skill">OpenGL</span>
        <span class="skill">Vulkan</span>
        <span class="skill">VueJS</span>
        <span class="skill">React</span>
      </div>

      <div class="skill-set">
        <h3>Tools & Software</h3>
        <span class="skill">Visual Studio</span>
        <span class="skill">Git</span>
        <span class="skill">Perforce</span>
        <span class="skill">Trello</span>
        <span class="skill">Blender</span>
        <span class="skill">Aseprite</span>
        <span class="skill">Adobe Illustrator</span>
        <span class="skill">Figma</span>
      </div>

      <h2>Languages</h2>

      <h3>Tamil</h3>
      <p>My mother tongue</p>

      <h3>English</h3>
      <p>Fluent speaker and excellent listener</p>

      <h2>I love...</h2>

      <h3>Video Games</h3>
      <p>
        My all time favorites are the God of War series, The Witcher 3, Red Dead
        Redemption 2, Elden Ring and Hades
      </p>

      <h3>Sports</h3>
      <p>I do a lot of weight-lifting and I love Cricket.</p>

      <h3>Books</h3>
      <p>
        I am an avid reader and some of my favorites are The Stranger, The
        Alchemist, Half Girlfriend ;)
      </p>

      <h3>Cinema</h3>
      <p>
        The movies and series I love: Spider-Man: Across the Spider-Verse, Game of
        Thrones, Peaky Blinders, One Piece.
      </p>
    </div>
  </div>
</template>
