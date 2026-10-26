'use strict';

/** Minimal typed-ish client for the FormForge REST API. */

const Api = (() => {
  async function request(path, { method = 'GET', body } = {}) {
    const opts = { method, headers: {} };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    let res;
    try {
      res = await fetch(path, opts);
    } catch (err) {
      throw new Error('Cannot reach the server. Is the backend running?');
    }
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    if (!res.ok) {
      const detail = data && data.error ? data.error : `Request failed (${res.status})`;
      const err = new Error(detail);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  return {
    health: () => request('/api/health'),
    meta: () => request('/api/forms/types'),

    listForms: () => request('/api/forms').then((d) => d.forms),
    getForm: (id) => request(`/api/forms/${id}`),
    getShare: (token) => request(`/api/forms/share/${encodeURIComponent(token)}`),
    createForm: (payload) => request('/api/forms', { method: 'POST', body: payload }),
    updateForm: (id, patch) => request(`/api/forms/${id}`, { method: 'PATCH', body: patch }),
    deleteForm: (id) => request(`/api/forms/${id}`, { method: 'DELETE' }),
    duplicateForm: (id) => request(`/api/forms/${id}/duplicate`, { method: 'POST' }),

    replaceFields: (id, fields) => request(`/api/forms/${id}/fields`, { method: 'PUT', body: { fields } }),
    addField: (id, field) => request(`/api/forms/${id}/fields`, { method: 'POST', body: field }),
    updateField: (fieldId, patch) => request(`/api/forms/fields/${fieldId}`, { method: 'PATCH', body: patch }),
    deleteField: (fieldId) => request(`/api/forms/fields/${fieldId}`, { method: 'DELETE' }),

    listResponses: (id, { limit = 100, offset = 0 } = {}) =>
      request(`/api/forms/${id}/responses?limit=${limit}&offset=${offset}`),
    submitResponse: (id, answers, source = 'web') =>
      request(`/api/forms/${id}/responses`, { method: 'POST', body: { answers, source } }),
    deleteResponse: (id, responseId) =>
      request(`/api/forms/${id}/responses/${responseId}`, { method: 'DELETE' }),
    analytics: (id) => request(`/api/forms/${id}/responses/analytics`),
  };
})();

window.Api = Api;
