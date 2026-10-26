'use strict';

/** Theme catalogue applied to the live form renderer. */

const THEMES = {
  indigo: { label: 'Indigo', accent: '#6366f1', accent600: '#4f46e5', bg: '#ffffff', tint: '#eef2ff' },
  ocean:  { label: 'Ocean',  accent: '#0ea5e9', accent600: '#0284c7', bg: '#f0f9ff', tint: '#e0f2fe' },
  sunset: { label: 'Sunset', accent: '#f97316', accent600: '#ea580c', bg: '#fff7ed', tint: '#ffedd5' },
  forest: { label: 'Forest', accent: '#10b981', accent600: '#059669', bg: '#ecfdf5', tint: '#d1fae5' },
  grape:  { label: 'Grape',  accent: '#8b5cf6', accent600: '#7c3aed', bg: '#faf5ff', tint: '#f3e8ff' },
  mono:   { label: 'Mono',   accent: '#18181b', accent600: '#000000', bg: '#fafafa', tint: '#f4f4f5' },
};

function themeOf(name) {
  return THEMES[name] || THEMES.indigo;
}

/** CSS custom properties for a formshell element. */
function themeVars(theme) {
  return {
    '--form-accent': theme.accent,
    '--form-accent600': theme.accent600,
    '--form-bg': theme.bg,
    '--form-tint': theme.tint,
  };
}

window.Themes = { THEMES, themeOf, themeVars };
