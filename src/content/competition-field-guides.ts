import originalGuides from "./competition-field-guides.json";
import newSeries from "./competition-series-20261104.json";

type FieldGuide = {
  experience: string;
  task: string;
  role: string;
  firstStep: string;
  investment: string;
  deliverable: string;
};
const guides = new Map<string, FieldGuide>(Object.entries(originalGuides));
for (const entry of newSeries) guides.set(entry.id, entry);

export function getCompetitionFieldGuide(id: string) {
  return guides.get(id);
}
