/**
 * Build-time constants.
 */

/**
 * NCBI asks tools that query E-utilities to identify themselves with a tool
 * name and a maintainer contact, so they can reach someone if a client
 * misbehaves. This is the *maintainer's* address, not the user's — nothing
 * about who is using the app is ever sent.
 *
 * Leave it empty and the parameter is omitted, which is allowed. Fill it in
 * before shipping: an unidentified client is the one NCBI blocks first when
 * it needs to throttle someone.
 */
export const NCBI_CONTACT_EMAIL = '';

/** Sent as the `tool` parameter alongside the contact address. */
export const NCBI_TOOL_NAME = 'researchbuddy';

/**
 * Shown persistently, not once. App Review guideline 1.4.1 targets apps that
 * could cause harm through inaccurate information, and a dismissed splash
 * screen is not a standing statement of what this app is.
 */
export const STANDING_DISCLAIMER = 'Literature search for study — not medical advice.';
