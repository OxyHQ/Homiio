"use strict";
/**
 * GB portal challenge heuristics shared by Rightmove, Zoopla, OnTheMarket, OpenRent.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isGbPortalChallenge = isGbPortalChallenge;
/** HTML markers of a UK portal interstitial / bot wall served with HTTP 200. */
function isGbPortalChallenge(html) {
    const trimmed = html.trim();
    if (trimmed.length < 200)
        return true;
    if (!/<html/i.test(html) && trimmed.length < 1024)
        return true;
    return /just a moment|cf-browser-verification|attention required|access denied|datadome|captcha-delivery|perimeterx|px-captcha|are you a robot|unusual traffic|enable javascript and cookies/i.test(html);
}
