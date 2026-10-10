'use strict';

// Ajustes de la aplicación: se leen antes de pintar para aplicar tema, acento, fuente y densidad sin parpadeo.
var WCSettings = (function () {
  var KEY = 'settings:v1';
  var DEFAULTS = {
    theme: 'dark', accent: 'wipecraft', zoom: 100, font: 'default', density: 'comfortable', motion: 'full',
    rpSpeed: 1, rpNames: true, rpTrails: false, rpPets: false, hdIcons: true, bossMaps: true, spellTips: true, updateSource: '', autoUpdateCheck: true,
  };
  var ACCENTS = {
    wipecraft: ['#2aa7b5', '#17779f'], gold: ['#e7b84a', '#a9741a'], blue: ['#5b8def', '#3a6fe0'], violet: ['#8b7bff', '#6a56e8'], cyan: ['#2fc4e8', '#0f93b5'], green: ['#3fc08a', '#1f9d6b'],
    orange: ['#f0a23b', '#d17f12'], pink: ['#ef5f9a', '#d03a78'], red: ['#ef5f6b', '#d6384a'],
  };
  var FONTS = {
    default: { label: 'Inter / Segoe UI', css: 'Inter, "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif' },
    segoe: { label: 'Segoe UI', css: '"Segoe UI", system-ui, sans-serif' },
    arial: { label: 'Arial', css: 'Arial, Helvetica, sans-serif' },
    verdana: { label: 'Verdana', css: 'Verdana, Geneva, sans-serif' },
    tahoma: { label: 'Tahoma', css: 'Tahoma, Verdana, sans-serif' },
    calibri: { label: 'Calibri', css: 'Calibri, "Segoe UI", sans-serif' },
    georgia: { label: 'Georgia', css: 'Georgia, "Times New Roman", serif' },
    consolas: { label: 'Consolas', css: 'Consolas, "Cascadia Mono", monospace' },
    comic: { label: 'Comic Sans', css: '"Comic Sans MS", "Chalkboard SE", cursive' },
  };
  var data = {};
  try { data = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { data = {}; }

  // Rediseño de la interfaz (v2.6): el acento azul antiguo pasa al dorado una sola vez
  if (data.ui !== 3) {
    if (data.accent === 'blue' || data.accent === 'gold') delete data.accent;
    data.ui = 3;
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* sin almacenamiento */ }
  }

  var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  function get(k) { return data[k] !== undefined ? data[k] : DEFAULTS[k]; }
  function resolvedTheme() {
    var t = get('theme');
    if (t === 'system') return mq && mq.matches ? 'dark' : 'light';
    return t === 'light' ? 'light' : 'dark';
  }

  function apply() {
    var root = document.documentElement;
    var theme = resolvedTheme();
    root.dataset.theme = theme;
    var acc = ACCENTS[get('accent')] || ACCENTS.blue;
    var accent = theme === 'light' ? acc[1] : acc[0];
    root.style.setProperty('--accent', accent);
    var n = parseInt(accent.slice(1), 16);
    var lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
    root.style.setProperty('--on-accent', lum > 0.55 ? '#1b1306' : '#ffffff');
    // el acento WipeCraft usa el degradado del logo (teal -> azul -> índigo); el resto, un degradado suave de su color
    root.style.setProperty('--accent-grad', get('accent') === 'wipecraft'
      ? 'linear-gradient(135deg, #19aaa8, #2c76b8 58%, #3e42c6)'
      : 'linear-gradient(180deg, color-mix(in srgb, ' + accent + ' 82%, #fff 18%), ' + accent + ')');
    var font = (FONTS[get('font')] || FONTS.default).css;
    root.style.setProperty('--font', font);
    window.UI_FONT = font;
    root.dataset.density = get('density');
    root.dataset.motion = get('motion');
  }

  function applyZoom() {
    try { if (window.api && window.api.setZoom) window.api.setZoom(get('zoom') / 100); } catch (e) { /* sin zoom */ }
  }

  function set(k, v) {
    data[k] = v;
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* sin almacenamiento */ }
    apply();
    if (k === 'zoom') applyZoom();
    if (window.R_REDRAW) window.R_REDRAW();
  }

  function reset() {
    data = {};
    try { localStorage.removeItem(KEY); } catch (e) { /* sin almacenamiento */ }
    apply();
    applyZoom();
  }

  if (mq && mq.addEventListener) mq.addEventListener('change', function () { if (get('theme') === 'system') apply(); });
  apply();
  document.addEventListener('DOMContentLoaded', applyZoom);

  return { get: get, set: set, reset: reset, apply: apply, applyZoom: applyZoom, ACCENTS: ACCENTS, FONTS: FONTS, DEFAULTS: DEFAULTS, resolvedTheme: resolvedTheme };
}());
