import { getCurrentAiConsentDisclosure } from "@/lib/ai/consent-disclosure";

function readFlag(name: string, fallback = "") {
  return process.env[name]?.trim() || fallback;
}

function isDisabled(value: string) {
  return ["0", "false", "off", "disabled"].includes(value.toLowerCase());
}

export function isAiFeatureEnabled() {
  return !isDisabled(readFlag("FEATURE_AI", "1"));
}

export function isCompetitionRecommenderEnabled() {
  return isAiFeatureEnabled() && !isDisabled(readFlag("FEATURE_COMPETITION_RECOMMENDER", "1"));
}

export function getAiConsentVersion() {
  return getCurrentAiConsentDisclosure().version;
}

export function getPublicContactEmail() {
  return readFlag("CONTACT_EMAIL", "contact@example.com");
}
