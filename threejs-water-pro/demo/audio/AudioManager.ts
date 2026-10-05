// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

/**
 * Manages ambient ocean audio that changes based on wind speed and camera position.
 * - Wind speed < 6: tranquil sounds
 * - Wind speed < 12: calm sounds
 * - Wind speed >= 25: storm sounds
 * - When camera is underwater: underwater ambience
 *
 * Only the active track plays at any given time. Inactive tracks are paused
 * to prevent mobile browsers from mixing all tracks simultaneously.
 */
export class AudioManager {
  private surfaceTracks: Map<string, HTMLAudioElement> = new Map();
  private underwaterTrack: HTMLAudioElement;
  private currentSurfaceTrack: string | null = null;
  private targetVolume: number = 0.5;
  private fadeSpeed: number = 0.5; // Volume change per second
  private muted: boolean = false;
  private initialized: boolean = false;
  private isUnderwater: boolean = false;

  constructor() {
    // Create audio elements for surface tracks
    const surfaceTrackNames = ["tranquil", "calm", "storm"];
    for (const name of surfaceTrackNames) {
      const audio = new Audio(`/audio/${name}.mp3`);
      audio.loop = true;
      audio.volume = 0;
      audio.preload = "auto";
      this.surfaceTracks.set(name, audio);
    }

    // Create underwater track
    this.underwaterTrack = new Audio("/audio/underwater.mp3");
    this.underwaterTrack.loop = true;
    this.underwaterTrack.volume = 0;
    this.underwaterTrack.preload = "auto";
  }

  /**
   * Initialize audio playback (must be called from user interaction).
   * Only starts the first appropriate track — others remain paused.
   */
  public async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
  }

  /**
   * Get the appropriate track name for a given wind speed
   */
  private getTrackForWindSpeed(windSpeed: number): string {
    if (windSpeed < 6) {
      return "tranquil";
    } else if (windSpeed < 12) {
      return "calm";
    } else {
      return "storm";
    }
  }

  /**
   * Start playing a track if it isn't already playing.
   */
  private ensurePlaying(audio: HTMLAudioElement): void {
    if (audio.paused) {
      audio.play().catch(() => {
        // Autoplay blocked — will retry next frame
      });
    }
  }

  /**
   * Pause a track once its volume has faded to 0.
   */
  private pauseIfSilent(audio: HTMLAudioElement): void {
    if (audio.volume === 0 && !audio.paused) {
      audio.pause();
    }
  }

  /**
   * Update the audio based on current wind speed and camera position
   * Call this in the animation loop
   * @param windSpeed Current wind speed for surface track selection
   * @param deltaTime Time since last frame in seconds
   * @param cameraY Camera Y position (underwater if < 0)
   */
  public update(windSpeed: number, deltaTime: number, cameraY: number): void {
    if (!this.initialized || this.muted) return;

    this.isUnderwater = cameraY < 0;
    const targetSurfaceTrack = this.getTrackForWindSpeed(windSpeed);

    // Set the current surface track if not set
    if (this.currentSurfaceTrack === null) {
      this.currentSurfaceTrack = targetSurfaceTrack;
    }

    const fadeAmount = this.fadeSpeed * deltaTime;

    if (this.isUnderwater) {
      // Fade in underwater (at 50% volume), fade out all surface tracks
      const underwaterVolume = this.targetVolume * 0.5;
      this.ensurePlaying(this.underwaterTrack);
      this.underwaterTrack.volume = Math.min(
        underwaterVolume,
        this.underwaterTrack.volume + fadeAmount,
      );
      for (const audio of this.surfaceTracks.values()) {
        audio.volume = Math.max(0, audio.volume - fadeAmount);
        this.pauseIfSilent(audio);
      }
    } else {
      // Fade out underwater, crossfade surface tracks
      this.underwaterTrack.volume = Math.max(
        0,
        this.underwaterTrack.volume - fadeAmount,
      );
      this.pauseIfSilent(this.underwaterTrack);

      for (const [name, audio] of this.surfaceTracks) {
        if (name === targetSurfaceTrack) {
          this.ensurePlaying(audio);
          audio.volume = Math.min(this.targetVolume, audio.volume + fadeAmount);
        } else {
          audio.volume = Math.max(0, audio.volume - fadeAmount);
          this.pauseIfSilent(audio);
        }
      }
    }

    this.currentSurfaceTrack = targetSurfaceTrack;
  }

  /**
   * Set the master volume (0-1)
   */
  public setVolume(volume: number): void {
    this.targetVolume = Math.max(0, Math.min(1, volume));
  }

  /**
   * Get the current volume
   */
  public getVolume(): number {
    return this.targetVolume;
  }

  /**
   * Mute/unmute all audio
   */
  public setMuted(muted: boolean): void {
    this.muted = muted;
    if (muted) {
      // Immediately mute and pause all tracks
      for (const audio of this.surfaceTracks.values()) {
        audio.volume = 0;
        audio.pause();
      }
      this.underwaterTrack.volume = 0;
      this.underwaterTrack.pause();
    }
  }

  /**
   * Check if audio is muted
   */
  public isMuted(): boolean {
    return this.muted;
  }
}
