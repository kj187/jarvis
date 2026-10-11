<script setup lang="ts">
import { ref } from 'vue'
import teaserSrc from '../../../content/assets/jarvis-teaser.mp4'
import teaserPosterSrc from '../../../content/assets/jarvis-teaser-poster.jpg'

const video = ref<HTMLVideoElement | null>(null)
const playing = ref(false)
// The native control bar only appears once playback has started, so the play
// button owns the whole poster before that.
const started = ref(false)

function play() {
  started.value = true
  void video.value?.play()
}
</script>

<template>
  <section class="home-intro-video-wrap" aria-labelledby="home-intro-video-title">
    <div class="home-intro-video">
      <h2 id="home-intro-video-title">See Jarvis in action</h2>
      <!-- Starts only on the visitor's click, so it needs no
           reduced-motion branch and its voice-over never plays unasked. -->
      <div class="video-cover">
        <video
          ref="video"
          :controls="started"
          playsinline
          preload="none"
          :poster="teaserPosterSrc"
          aria-label="Jarvis teaser with voice-over: an alert fires, gets claimed and silenced, resolves, and its history stays — 45 seconds"
          @play="playing = true"
          @pause="playing = false"
          @ended="playing = false"
        >
          <source :src="teaserSrc" type="video/mp4" />
        </video>
        <button
          v-show="!playing"
          type="button"
          class="video-play"
          :class="{ 'video-play-paused': started }"
          aria-label="Play the Jarvis teaser"
          @click="play"
        >
          <svg viewBox="0 0 96 96" aria-hidden="true">
            <circle cx="48" cy="48" r="45" />
            <path d="M38 28v40l34-20z" />
          </svg>
        </button>
      </div>
      <p>
        Jarvis in 45 seconds. For the full tour,
        <a href="https://www.youtube.com/watch?v=gssfmws8B6o" target="_blank" rel="noreferrer"
          >watch the two-and-a-half-minute intro on YouTube</a
        >.
      </p>
    </div>
  </section>
</template>
