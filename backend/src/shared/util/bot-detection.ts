/**
 * User-agent deny-list for usage counters.
 *
 * Unfiltered numbers on a public library site are dominated by crawlers, so
 * "most viewed record" would rank whatever Googlebot happened to walk first.
 * This is a deny-list, not a proof: it is deliberately cheap and errs toward
 * counting a real visitor rather than dropping one.
 *
 * A missing or empty user-agent counts as a bot — every real browser sends one,
 * and scripted traffic frequently does not.
 */
const BOT_PATTERN =
  /bot|crawl|spider|slurp|scrap|curl\/|wget|python-requests|httpie|okhttp|java\/|go-http-client|axios\/|node-fetch|libwww|headlesschrome|phantomjs|lighthouse|monitoring|uptime|pingdom|semrush|ahrefs|mj12|dotbot|yandex|baidu|bingpreview|facebookexternalhit|whatsapp|telegram|preview/i;

export function isBotUserAgent(userAgent: string | undefined | null): boolean {
  if (!userAgent || userAgent.trim() === '') return true;
  return BOT_PATTERN.test(userAgent);
}
