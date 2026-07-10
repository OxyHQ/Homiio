/**
 * Shared AJAX / JSON challenge heuristics (DataDome, PerimeterX, empty bodies).
 */

/** True when an AJAX body is a bot challenge rather than portal JSON/HTML. */
export function isDataDomeAjaxChallenge(body: string): boolean {
  const trimmed = body.trim();
  if (trimmed.length === 0) return true;
  if (/captcha-delivery\.com|geo\.captcha|datadome|acceso denegado|accesso negato|px-captcha/i.test(trimmed)) {
    return true;
  }
  if (trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html')) return true;
  if (/sentimos la interrupci|pardon our interruption|verifica que eres/i.test(trimmed)) return true;
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return /"url"\s*:\s*"https?:\/\/geo\.captcha/i.test(trimmed);
  }
  return false;
}
