import sunset from './sunset.js';
import glacier from './glacier.js';
import verdant from './verdant.js';
import ember from './ember.js';

/** Every circuit the game knows about, in menu order. */
export const TRACKS = [sunset, glacier, verdant, ember];

export const DEFAULT_TRACK = sunset.id;

export function trackById(id) {
  return TRACKS.find((t) => t.id === id) || TRACKS[0];
}
