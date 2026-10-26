'use strict';

/**
 * Field type catalogue + icon set.
 * `icon` is a 16x16 inline SVG string used in the builder palette and field blocks.
 */

const S = (path, extra) =>
  `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}${extra || ''}</svg>`;

const FIELD_TYPES = {
  section: {
    label: 'Section',
    group: 'Layout',
    icon: S('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18"/>'),
  },
  text: {
    label: 'Short text',
    group: 'Answer',
    icon: S('<path d="M4 7V5h16v2"/><path d="M12 5v14"/><path d="M8 19h8"/>'),
  },
  paragraph: {
    label: 'Long text',
    group: 'Answer',
    icon: S('<path d="M21 6H3"/><path d="M21 12H3"/><path d="M15 18H3"/>'),
  },
  email: {
    label: 'Email',
    group: 'Answer',
    icon: S('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>'),
  },
  number: {
    label: 'Number',
    group: 'Answer',
    icon: S('<path d="M4 9h16"/><path d="M4 15h16"/><path d="M12 3 8 21"/><path d="M16 3 12 21"/>'),
  },
  url: {
    label: 'Website',
    group: 'Answer',
    icon: S('<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a13 13 0 0 1 0 18 13 13 0 0 1 0-18"/>'),
  },
  phone: {
    label: 'Phone',
    group: 'Answer',
    icon: S('<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.6 2.6a2 2 0 0 1-.5 2.1L8 9.6a16 16 0 0 0 6 6l1.2-1.2a2 2 0 0 1 2.1-.5c.8.3 1.7.5 2.6.6a2 2 0 0 1 1.7 2z"/>'),
  },
  date: {
    label: 'Date',
    group: 'Answer',
    icon: S('<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/>'),
  },
  radio: {
    label: 'Multiple choice',
    group: 'Choices',
    icon: S('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.5" fill="currentColor" stroke="none"/>'),
  },
  checkboxes: {
    label: 'Checkboxes',
    group: 'Choices',
    icon: S('<rect x="3" y="3" width="18" height="18" rx="4"/><path d="m8 12 3 3 6-6"/>'),
  },
  dropdown: {
    label: 'Dropdown',
    group: 'Choices',
    icon: S('<path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h16"/>'),
  },
  rating: {
    label: 'Rating',
    group: 'Scale',
    icon: S('<path d="m12 3 2.7 5.5 6 .9-4.3 4.2 1 6-5.4-2.8L6.6 19.6l1-6L3.3 9.4l6-.9z"/>'),
  },
  scale: {
    label: 'Scale',
    group: 'Scale',
    icon: S('<path d="M3 17h2"/><path d="M8 13h2"/><path d="M13 9h2"/><path d="M18 5h2"/><path d="M3 21h18"/>'),
  },
  yesno: {
    label: 'Yes / No',
    group: 'Choices',
    icon: S('<path d="m9 11 3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>'),
  },
};

const TYPE_GROUPS = ['Layout', 'Answer', 'Choices', 'Scale'];

function iconFor(type, size) {
  const t = FIELD_TYPES[type] || FIELD_TYPES.text;
  return String(t.icon).replace('width="16" height="16"', `width="${size || 16}" height="${size || 16}"`);
}

window.Icons = { FIELD_TYPES, TYPE_GROUPS, iconFor };
