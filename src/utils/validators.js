export function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '').slice(0, 9);
}

export function detectProvider(phone) {
  const normalized = normalizePhone(phone);

  if (/^(84|85)\d{7}$/.test(normalized)) {
    return 'mpesa';
  }

  if (/^(86|87)\d{7}$/.test(normalized)) {
    return 'emola';
  }

  return null;
}

export function sanitizeHotspotValue(value, fallback = '') {
  const text = String(value || '').trim();

  if (!text || text.includes('$(')) {
    return fallback;
  }

  return text.slice(0, 255);
}

export function createReference() {
  const random = Math.floor(10 + Math.random() * 90);
  return `ISP${Date.now()}${random}`;
}
